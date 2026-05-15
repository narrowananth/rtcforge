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
    PeerRole,
    RoomEvent,
    ServerEvent,
} from './types.js'
import type { AuthPayload, SignalingServerOptions } from './types.js'

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
    private wss?: WebSocketServer
    private ownServer?: http.Server
    private heartbeatTimer?: ReturnType<typeof setInterval>
    private readonly rooms = new Map<string, Room>()

    private readonly PING_INTERVAL: number
    private readonly PONG_TIMEOUT: number

    constructor(opts: SignalingServerOptions = {}) {
        super()
        this.opts = opts
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

        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req).catch((err: Error) => {
                ws.close(CloseCode.PolicyViolation, err.message)
            })
        })

        this.wss.on('error', (err) => this.emit(ServerEvent.Error, err))
        this.startHeartbeat()
    }

    async stop(): Promise<void> {
        if (this.heartbeatTimer !== undefined) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = undefined
        }

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
                    ws.close(CloseCode.PolicyViolation, CloseReason.InvalidAuthPayload)
                    return
                }
                payload = result.data
            } catch (err) {
                ws.close(
                    CloseCode.PolicyViolation,
                    err instanceof Error ? err.message : CloseReason.AuthFailed,
                )
                return
            }
        } else {
            const roomId = url.searchParams.get('roomId')
            const peerId = url.searchParams.get('peerId')
            if (!roomId || !peerId) {
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
            room.on(RoomEvent.Closed, () => this.rooms.delete(roomId))
        }

        const activeRoom = room
        const onSignal = (to: string, data: unknown) => activeRoom.relay(peerId, to, data)
        const peer = new Peer(peerId, role, ws, onSignal)
        room.addPeer(peer)

        if (isNewRoom) {
            this.emit(ServerEvent.RoomCreated, room)
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimer = setInterval(() => {
            const deadline = Date.now() - this.PONG_TIMEOUT
            for (const room of this.rooms.values()) {
                for (const peer of room.getPeers()) {
                    if (peer.lastPong < deadline) {
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
