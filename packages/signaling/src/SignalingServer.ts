import http from 'node:http'
import { EventEmitter } from '@rtcforge/core'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { Authenticator } from './Authenticator.js'
import { HeartbeatMonitor } from './HeartbeatMonitor.js'
import { Peer } from './Peer.js'
import type { Room } from './Room.js'
import { RoomRegistry, RoomRegistryEvent } from './RoomRegistry.js'
import { RoomRouter } from './RoomRouter.js'
import { MessageType } from './protocol.js'
import type { NodeInfo } from './types.js'
import {
    CloseCode,
    CloseReason,
    Metric,
    PeerEvent,
    ServerEvent,
    noopLogger,
    noopMetrics,
} from './types.js'
import type { IceServerConfig, Logger, MetricsCollector, SignalingServerOptions } from './types.js'

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
    private readonly registry: RoomRegistry
    private readonly authenticator: Authenticator
    private readonly heartbeat: HeartbeatMonitor
    private readonly router?: RoomRouter

    private wss?: WebSocketServer
    private ownServer?: http.Server
    private startedAt = 0
    private _stopped = false

    constructor(opts: SignalingServerOptions = {}) {
        super()
        this.opts = opts
        this.logger = opts.logger ?? noopLogger
        this.metrics = opts.metrics ?? noopMetrics

        this.registry = new RoomRegistry({
            maxPeers: opts.maxPeersPerRoom,
            maxDurationMs: opts.roomMaxDurationMs,
            idleTimeoutMs: opts.roomIdleTimeoutMs,
        })
        this.authenticator = new Authenticator({
            auth: opts.auth,
            serverAssignedPeerId: opts.serverAssignedPeerId,
            logger: this.logger,
            metrics: this.metrics,
        })
        this.heartbeat = new HeartbeatMonitor({
            rooms: () => this.registry.rooms(),
            pingIntervalMs: opts.pingInterval ?? 30_000,
            pongTimeoutMs: opts.pongTimeout ?? 60_000,
            logger: this.logger,
        })

        if (opts.cluster) {
            this.router = new RoomRouter({
                selfId: opts.cluster.selfId,
                membership: opts.cluster.membership,
            })
        }

        this.registry.on(RoomRegistryEvent.RoomClosed, (roomId) => this.onRoomClosed(roomId))
        this.registry.on(RoomRegistryEvent.PeerKicked, (roomId, peerId, reason) =>
            this.onPeerKicked(roomId, peerId, reason),
        )
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
        this.heartbeat.start()

        const addr = this.ownServer?.address()
        const port = addr && typeof addr === 'object' ? addr.port : (this.opts.port ?? 3000)
        this.logger.info('SignalingServer started', { port })
    }

    async stop(): Promise<void> {
        if (this._stopped) return
        this._stopped = true
        this.logger.info('SignalingServer stopping')

        this.heartbeat.stop()
        this.router?.dispose()
        this.registry.disconnectAll(CloseReason.ServerStopping)

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
        return this.registry.get(roomId)
    }

    getOwner(roomId: string): NodeInfo | undefined {
        return this.router?.owner(roomId)
    }

    getStats(): ServerStats {
        return {
            rooms: this.registry.size,
            peers: this.registry.totalPeers(),
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

    private onRoomClosed(roomId: string): void {
        this.emit(ServerEvent.RoomClosed, roomId)
        this.logger.info('Room closed', { roomId })
        this.metrics.increment(Metric.RoomsClosed)
        this.metrics.gauge(Metric.ActiveRooms, this.registry.size)
        this.opts.auditLog?.({ type: 'room-closed', roomId, ts: Date.now() })
    }

    private onPeerKicked(roomId: string, peerId: string, reason: string | undefined): void {
        this.logger.info('Peer kicked', { peerId, roomId, reason })
        this.metrics.increment(Metric.PeersKicked)
        this.opts.auditLog?.({
            type: 'peer-kicked',
            roomId,
            peerId,
            ts: Date.now(),
            detail: reason ? { reason } : undefined,
        })
    }

    private async handleConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
        const result = await this.authenticator.resolve(req)
        if (!result.ok) {
            ws.close(result.code, result.reason)
            return
        }

        const { roomId, peerId, role, metadata } = result.auth

        const route = this.router?.route(roomId)
        if (route && !route.isLocal) {
            const owner = route.owner
            this.logger.info('Redirecting peer to room owner', {
                peerId,
                roomId,
                owner: owner?.id,
            })
            this.metrics.increment(Metric.SignalsRelayed, { kind: 'redirect' })
            this.opts.onRedirect?.(peerId, roomId, owner)
            ws.close(CloseCode.PolicyViolation, CloseReason.WrongNode)
            return
        }

        const { room, isNew } = this.registry.getOrCreate(roomId)

        const onSignal = (to: string, data: unknown) => {
            if (room.relay(peerId, to, data)) this.metrics.increment(Metric.SignalsRelayed)
        }
        const peer = new Peer({
            id: peerId,
            role,
            ws,
            onSignal,
            metadata,
            maxMessagesPerSecond: this.opts.rateLimit?.maxMessagesPerSecond,
        })

        peer.on(PeerEvent.Error, (err) => {
            this.logger.warn('Peer error', { peerId: peer.id, err: err.message })
        })

        peer.on(PeerEvent.Pong, () => room.markActivity())
        peer.on(PeerEvent.RateLimitExceeded, () => {
            this.logger.warn('Peer rate limit exceeded — message dropped', { peerId, roomId })
        })
        peer.on(PeerEvent.Broadcast, (channel: string, data: unknown) => {
            room.broadcastExcept(peerId, {
                type: MessageType.Broadcast,
                from: peerId,
                channel,
                data,
                ts: Date.now(),
            })
            this.metrics.increment(Metric.BroadcastsRelayed)
        })

        let iceServers: IceServerConfig[] | undefined
        let added: boolean
        try {
            iceServers = this.opts.iceServersHook
                ? ((await this.opts.iceServersHook(peerId, roomId)) ?? undefined)
                : undefined
            added = room.addPeer(peer, iceServers)
        } catch (err) {
            this.registry.rollbackIfEmpty(roomId, isNew)
            throw err
        }

        if (!added) {
            this.registry.rollbackIfEmpty(roomId, isNew)
            return
        }

        this.opts.auditLog?.({ type: 'peer-joined', roomId, peerId, ts: Date.now() })

        peer.once(PeerEvent.Disconnected, () => {
            this.logger.info('Peer left', { peerId, roomId })
            this.metrics.increment(Metric.PeersDisconnected)
            this.metrics.gauge(Metric.ActivePeers, this.registry.totalPeers())
            this.opts.auditLog?.({ type: 'peer-left', roomId, peerId, ts: Date.now() })
        })

        this.logger.info('Peer joined', { peerId, roomId, role })
        this.metrics.increment(Metric.PeersConnected, { role })
        this.metrics.gauge(Metric.ActivePeers, this.registry.totalPeers())

        if (isNew) {
            this.logger.info('Room created', { roomId })
            this.metrics.increment(Metric.RoomsCreated)
            this.metrics.gauge(Metric.ActiveRooms, this.registry.size)
            this.emit(ServerEvent.RoomCreated, room)
            this.opts.auditLog?.({ type: 'room-created', roomId, ts: Date.now() })
        }
    }
}
