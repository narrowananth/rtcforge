import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { EventEmitter } from '@rtcforge/core'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { Peer } from './Peer.js'
import { Room } from './Room.js'
import { MessageType } from './protocol.js'
import {
    AuthPayloadSchema,
    CloseCode,
    CloseReason,
    Metric,
    PeerEvent,
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

type SignalingServerEvents = {
    [ServerEvent.RoomCreated]: [room: Room]
    [ServerEvent.RoomClosed]: [roomId: string]
    [ServerEvent.Error]: [err: Error]
}

export class SignalingServer extends EventEmitter<SignalingServerEvents> {
    private readonly opts: SignalingServerOptions
    private readonly logger: Logger
    private readonly metrics: MetricsCollector
    private wss?: WebSocketServer
    private ownServer?: http.Server
    private heartbeatTimer?: ReturnType<typeof setInterval>
    private readonly rooms = new Map<string, Room>()
    private startedAt = 0
    private _stopped = false

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
                this.logger.error('Connection handler error', { err: err.message })
                ws.close(CloseCode.PolicyViolation, 'Internal error')
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

    getRoom(roomId: string): Room | undefined {
        return this.rooms.get(roomId)
    }

    getStats(): ServerStats {
        return {
            rooms: this.rooms.size,
            peers: this.activePeerCount(),
            uptime: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
        }
    }

    attachHealthEndpoint(server: http.Server, path = '/health'): void {
        server.on('request', (req, res) => {
            if (req.method === 'GET' && req.url?.split('?')[0] === path) {
                const stats = this.getStats()
                const body = JSON.stringify({ status: 'ok', ...stats })
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(body)
            }
        })
    }

    private activePeerCount(): number {
        let count = 0
        for (const room of this.rooms.values()) count += room.getPeerCount()
        return count
    }

    private _rollbackNewRoom(roomId: string, isNewRoom: boolean, room: Room): void {
        if (isNewRoom && room.getPeerCount() === 0) {
            this.rooms.delete(roomId)
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
            payload = { roomId, peerId, role: '' }
        }

        const { roomId, role } = payload
        const peerId = this.opts.serverAssignedPeerId ? randomUUID() : payload.peerId

        let room = this.rooms.get(roomId)
        const isNewRoom = !room

        if (!room) {
            room = new Room(roomId, {
                maxPeers: this.opts.maxPeersPerRoom,
                maxDurationMs: this.opts.roomMaxDurationMs,
                idleTimeoutMs: this.opts.roomIdleTimeoutMs,
            })
            this.rooms.set(roomId, room)
            room.on(RoomEvent.Closed, () => {
                this.rooms.delete(roomId)
                this.emit(ServerEvent.RoomClosed, roomId)
                this.logger.info('Room closed', { roomId })
                this.metrics.increment(Metric.RoomsClosed)
                this.metrics.gauge(Metric.ActiveRooms, this.rooms.size)
                this.opts.auditLog?.({ type: 'room-closed', roomId, ts: Date.now() })
            })
            room.on(RoomEvent.PeerKicked, (kickedPeerId, reason) => {
                this.logger.info('Peer kicked', { peerId: kickedPeerId, roomId, reason })
                this.metrics.increment(Metric.PeersKicked)
                this.opts.auditLog?.({
                    type: 'peer-kicked',
                    roomId,
                    peerId: kickedPeerId,
                    ts: Date.now(),
                    detail: reason ? { reason } : undefined,
                })
            })
        }

        const activeRoom = room
        const onSignal = (to: string, data: unknown) => {
            if (activeRoom.relay(peerId, to, data)) {
                this.metrics.increment(Metric.SignalsRelayed)
            }
        }
        const peer = new Peer(
            peerId,
            role,
            ws,
            onSignal,
            payload.metadata ?? {},
            this.opts.rateLimit?.maxMessagesPerSecond,
        )

        peer.on(PeerEvent.Error, (err) => {
            this.logger.warn('Peer error', { peerId: peer.id, err: err.message })
        })

        peer.on(PeerEvent.Broadcast, (channel: string, data: unknown) => {
            activeRoom.broadcastExcept(peerId, {
                type: MessageType.Broadcast,
                from: peerId,
                channel,
                data,
                ts: Date.now(),
            })
            this.metrics.increment(Metric.BroadcastsRelayed)
        })

        let iceServers: import('./types.js').IceServerConfig[] | undefined
        try {
            iceServers = this.opts.iceServersHook
                ? ((await this.opts.iceServersHook(peerId, roomId)) ?? undefined)
                : undefined
        } catch (err) {
            this._rollbackNewRoom(roomId, isNewRoom, room)
            throw err
        }
        try {
            room.addPeer(peer, iceServers)
        } catch (err) {
            this._rollbackNewRoom(roomId, isNewRoom, room)
            throw err
        }
        this.opts.auditLog?.({ type: 'peer-joined', roomId, peerId, ts: Date.now() })

        peer.once(PeerEvent.Disconnected, () => {
            this.logger.info('Peer left', { peerId, roomId })
            this.metrics.increment(Metric.PeersDisconnected)
            this.metrics.gauge(Metric.ActivePeers, this.activePeerCount())
            this.opts.auditLog?.({ type: 'peer-left', roomId, peerId, ts: Date.now() })
        })

        this.logger.info('Peer joined', { peerId, roomId, role })
        this.metrics.increment(Metric.PeersConnected, { role })
        this.metrics.gauge(Metric.ActivePeers, this.activePeerCount())

        if (isNewRoom) {
            this.logger.info('Room created', { roomId })
            this.metrics.increment(Metric.RoomsCreated)
            this.metrics.gauge(Metric.ActiveRooms, this.rooms.size)
            this.emit(ServerEvent.RoomCreated, room)
            this.opts.auditLog?.({ type: 'room-created', roomId, ts: Date.now() })
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            const deadline = Date.now() - this.PONG_TIMEOUT
            for (const room of this.rooms.values()) {
                for (const peer of room.getPeers()) {
                    if (!peer.isAlive(deadline)) {
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
