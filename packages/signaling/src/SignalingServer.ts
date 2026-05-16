import { EventEmitter } from 'node:events'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { Peer } from './Peer.js'
import { Room } from './Room.js'
import {
    AuthPayloadSchema,
    CloseCode,
    CloseReason,
    Metric,
    PeerEvent,
    PeerRole,
    RoomEvent,
    ServerEvent,
    noopLogger,
    noopMetrics,
} from './types.js'
import type { AuthPayload, Logger, MetricsCollector, SignalingServerOptions } from './types.js'

export interface ServerStats {
    rooms: number
    peers: number
    uptime: number
}

export declare interface SignalingServer {
    on(event: typeof ServerEvent.RoomCreated, listener: (room: Room) => void): this
    on(event: typeof ServerEvent.Error, listener: (err: Error) => void): this
    once(event: typeof ServerEvent.RoomCreated, listener: (room: Room) => void): this
    once(event: typeof ServerEvent.Error, listener: (err: Error) => void): this
    emit(event: typeof ServerEvent.RoomCreated, room: Room): boolean
    emit(event: typeof ServerEvent.Error, err: Error): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter overload pattern
export class SignalingServer extends EventEmitter {
    private readonly opts: SignalingServerOptions
    private readonly logger: Logger
    private readonly metrics: MetricsCollector
    private wss?: WebSocketServer
    private ownServer?: http.Server
    private heartbeatTimer?: ReturnType<typeof setInterval>
    private readonly rooms = new Map<string, Room>()
    private startedAt = 0
    private _stopped = false
    private _peerCount = 0

    private readonly PING_INTERVAL: number
    private readonly PONG_TIMEOUT: number

    constructor(opts: SignalingServerOptions = {}) {
        super()
        this.opts = opts
        this.logger = opts.logger ?? noopLogger
        this.metrics = opts.metrics ?? noopMetrics
        this.PING_INTERVAL = opts.pingInterval ?? 30_000
        this.PONG_TIMEOUT = opts.pongTimeout ?? 60_000
    }

    async start(): Promise<void> {
        if (this.opts.server) {
            this.wss = new WebSocketServer({ server: this.opts.server })
        } else {
            const ownServer = http.createServer()
            this.ownServer = ownServer
            this.wss = new WebSocketServer({ server: ownServer })
            await new Promise<void>((resolve, reject) => {
                ownServer.on('error', reject)
                ownServer.listen(this.opts.port ?? 3000, resolve)
            })
        }

        this.startedAt = Date.now()

        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req).catch((err: Error) => {
                ws.close(CloseCode.PolicyViolation, err.message)
            })
        })

        this.wss.on('error', (err) => {
            this.logger.error('WebSocket server error', { err: err.message })
            this.emit(ServerEvent.Error, err)
        })
        this.startHeartbeat()

        const addr = this.ownServer?.address()
        const port = addr && typeof addr === 'object' ? addr.port : (this.opts.port ?? 3000)
        this.logger.info('SignalingServer started', { port })
    }

    async stop(): Promise<void> {
        if (this._stopped) return
        this._stopped = true
        this.logger.info('SignalingServer stopping')

        if (this.heartbeatTimer !== undefined) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = undefined
        }

        for (const room of this.rooms.values()) {
            for (const peer of room.getPeers()) {
                peer.disconnect(CloseCode.Normal, CloseReason.ServerStopping)
            }
        }
        this.rooms.clear()

        await new Promise<void>((resolve, reject) => {
            if (!this.wss) return resolve()
            this.wss.close((err) => (err ? reject(err) : resolve()))
        })

        if (this.ownServer) {
            const ownServer = this.ownServer
            await new Promise<void>((resolve, reject) => {
                ownServer.close((err) => (err ? reject(err) : resolve()))
            })
        }

        this.logger.info('SignalingServer stopped')
    }

    getStats(): ServerStats {
        let peers = 0
        for (const room of this.rooms.values()) {
            peers += room.getPeerCount()
        }
        return {
            rooms: this.rooms.size,
            peers,
            uptime: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
        }
    }

    private async handleConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
        const url = new URL(req.url ?? '/', 'ws://localhost')
        const token = url.searchParams.get('token') ?? ''

        let payload: AuthPayload

        if (this.opts.auth) {
            try {
                const raw = await this.opts.auth(token)
                const result = AuthPayloadSchema.safeParse(raw)
                if (!result.success) {
                    this.logger.warn('Auth failed: invalid payload', { token })
                    this.metrics.increment(Metric.AuthErrors, { reason: 'invalid_payload' })
                    ws.close(CloseCode.PolicyViolation, CloseReason.InvalidAuthPayload)
                    return
                }
                payload = result.data
            } catch (err) {
                const reason = err instanceof Error ? err.message : CloseReason.AuthFailed
                this.logger.warn('Auth failed', { reason })
                this.metrics.increment(Metric.AuthErrors, { reason: 'auth_exception' })
                ws.close(CloseCode.PolicyViolation, reason)
                return
            }
        } else {
            const roomId = url.searchParams.get('roomId')
            const peerId = url.searchParams.get('peerId')
            if (!roomId || !peerId) {
                this.logger.warn('Auth failed: missing roomId or peerId')
                this.metrics.increment(Metric.AuthErrors, { reason: 'missing_params' })
                ws.close(CloseCode.PolicyViolation, CloseReason.MissingRoomOrPeer)
                return
            }
            payload = { roomId, peerId, role: PeerRole.Participant }
        }

        const { roomId, peerId, role } = payload

        let room = this.rooms.get(roomId)
        const isNewRoom = !room

        if (!room) {
            room = new Room(roomId)
            this.rooms.set(roomId, room)
            room.on(RoomEvent.Closed, () => {
                this.rooms.delete(roomId)
                this.logger.info('Room closed', { roomId })
                this.metrics.increment(Metric.RoomsClosed)
                this.metrics.gauge(Metric.ActiveRooms, this.rooms.size)
            })
        }

        const activeRoom = room
        const onSignal = (to: string, data: unknown) => {
            activeRoom.relay(peerId, to, data)
            this.metrics.increment(Metric.SignalsRelayed)
        }
        const peer = new Peer(peerId, role, ws, onSignal)

        peer.once(PeerEvent.Disconnected, () => {
            this.logger.info('Peer left', { peerId, roomId })
            this.metrics.increment(Metric.PeersDisconnected)
            this._peerCount = Math.max(0, this._peerCount - 1)
            this.metrics.gauge(Metric.ActivePeers, this._peerCount)
        })

        room.addPeer(peer)
        this._peerCount++

        this.logger.info('Peer joined', { peerId, roomId, role })
        this.metrics.increment(Metric.PeersConnected, { role })
        this.metrics.gauge(Metric.ActivePeers, this._peerCount)

        if (isNewRoom) {
            this.logger.info('Room created', { roomId })
            this.metrics.increment(Metric.RoomsCreated)
            this.metrics.gauge(Metric.ActiveRooms, this.rooms.size)
            this.emit(ServerEvent.RoomCreated, room)
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            const deadline = Date.now() - this.PONG_TIMEOUT
            for (const room of this.rooms.values()) {
                for (const peer of room.getPeers()) {
                    if (peer.lastPong < deadline) {
                        this.logger.warn('Heartbeat timeout, disconnecting peer', {
                            peerId: peer.id,
                        })
                        peer.disconnect(CloseCode.GoingAway, CloseReason.HeartbeatTimeout)
                    } else {
                        peer.ping()
                    }
                }
            }
        }, this.PING_INTERVAL)
        this.heartbeatTimer.unref()
    }
}
