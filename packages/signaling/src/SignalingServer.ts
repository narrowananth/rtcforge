import http from 'node:http'
import { EventEmitter } from 'rtcforge-core'
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

const DEFAULT_MAX_PAYLOAD_BYTES = 262_144
const DEFAULT_MAX_CONNECTIONS = 10_000
const DEFAULT_MAX_ROOMS = 10_000
const DEFAULT_MAX_MESSAGES_PER_SECOND = 100

/**
 * A point-in-time snapshot of server activity, returned by
 * {@link SignalingServer.getStats}.
 */
export interface ServerStats {
    /** Number of rooms currently held in the registry. */
    rooms: number
    /** Total number of connected peers across all rooms. */
    peers: number
    /** Milliseconds elapsed since {@link SignalingServer.start} was called, or `0` if not started. */
    uptime: number
}

type SignalingServerEvents = {
    [ServerEvent.RoomCreated]: [room: Room]
    [ServerEvent.RoomClosed]: [roomId: string]
    [ServerEvent.Error]: [err: Error]
}

/**
 * WebSocket signaling server that brokers WebRTC negotiation between peers
 * grouped into rooms.
 *
 * @remarks
 * The server accepts WebSocket connections, authenticates each one through the
 * {@link AuthFunction} configured in {@link SignalingServerOptions.auth},
 * places the peer into the room named by its auth payload, and relays directed
 * `signal` and room-wide `broadcast` messages between peers. It also enforces
 * per-peer rate limiting ({@link SignalingServerOptions.rateLimit}), prunes
 * dead connections with a ping/pong heartbeat
 * ({@link SignalingServerOptions.pingInterval} /
 * {@link SignalingServerOptions.pongTimeout}), and — when
 * {@link SignalingServerOptions.cluster} is set — shards rooms across nodes via
 * a {@link RoomRouter}, redirecting connections that reach the wrong node.
 *
 * It extends the core `EventEmitter` and emits {@link ServerEvent} values:
 * {@link ServerEvent.RoomCreated}, {@link ServerEvent.RoomClosed}, and
 * {@link ServerEvent.Error}.
 *
 * @example
 * ```ts
 * import { SignalingServer, ServerEvent } from 'rtcforge-signaling'
 *
 * const server = new SignalingServer({
 *   port: 3000,
 *   auth: async (token) => {
 *     const claims = await verifyJwt(token)
 *     return { roomId: claims.room, peerId: claims.sub, role: claims.role }
 *   },
 *   maxPeersPerRoom: 8,
 *   rateLimit: { maxMessagesPerSecond: 50 },
 * })
 *
 * server.on(ServerEvent.RoomCreated, (room) => {
 *   console.log('room created', room.id)
 * })
 *
 * await server.start()
 * // ... later
 * await server.stop()
 * ```
 */
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
    private _connections = 0
    private readonly maxConnections: number
    private readonly maxRooms: number
    private readonly maxPayloadBytes: number
    private readonly effectiveRateLimit: number | undefined

    /**
     * Creates a signaling server. No socket is opened until
     * {@link SignalingServer.start} is called.
     *
     * @param opts - Server configuration; see {@link SignalingServerOptions}.
     *   Defaults to an empty object (unauthenticated, port 3000, 30s ping /
     *   60s pong). When `opts.cluster` is provided, a {@link RoomRouter} is
     *   constructed for room sharding.
     */
    constructor(opts: SignalingServerOptions = {}) {
        super()
        this.opts = opts
        this.logger = opts.logger ?? noopLogger
        this.metrics = opts.metrics ?? noopMetrics

        this.maxConnections = opts.maxConnections ?? DEFAULT_MAX_CONNECTIONS
        this.maxRooms = opts.maxRooms ?? DEFAULT_MAX_ROOMS
        this.maxPayloadBytes = opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES
        // Rate limiting is on by default; an explicit 0 or negative disables it.
        const rl = opts.rateLimit?.maxMessagesPerSecond
        this.effectiveRateLimit =
            rl === undefined ? DEFAULT_MAX_MESSAGES_PER_SECOND : rl > 0 ? rl : undefined

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

    /**
     * Starts listening for connections and begins the heartbeat.
     *
     * @remarks
     * If {@link SignalingServerOptions.server} was provided, the WebSocket
     * server attaches to it; otherwise a new HTTP server is created and bound to
     * {@link SignalingServerOptions.port} (default 3000). Resolves once the
     * server is accepting connections.
     *
     * @returns A promise that resolves when the server is listening.
     * @throws If the underlying HTTP server fails to bind (e.g. port in use).
     */
    async start(): Promise<void> {
        // Re-entrancy guard: a second start() would overwrite this.wss and leak
        // the first server + its listeners.
        if (this.wss) throw new Error('SignalingServer already started')
        this._stopped = false
        if (this.opts.server) {
            this.wss = new WebSocketServer({
                server: this.opts.server,
                maxPayload: this.maxPayloadBytes,
            })
        } else {
            const ownServer = http.createServer()
            this.ownServer = ownServer
            this.wss = new WebSocketServer({ server: ownServer, maxPayload: this.maxPayloadBytes })
            try {
                await new Promise<void>((resolve, reject) => {
                    ownServer.on('error', reject)
                    ownServer.listen(this.opts.port ?? 3000, resolve)
                })
            } catch (err) {
                // Bind failed (e.g. EADDRINUSE): reset so a retry start() works and
                // a recovery stop() doesn't close a never-listening server.
                this.wss = undefined
                this.ownServer = undefined
                throw err
            }
        }

        this.startedAt = Date.now()

        this.wss.on('connection', (ws, req) => {
            // Attach a socket 'error' handler SYNCHRONOUSLY, before any await.
            // The Peer's own listener is added only after async auth/iceServersHook,
            // so without this a client that RSTs during auth — or on any rejection
            // path below — would emit 'error' with no listener and crash the process.
            ws.on('error', (err: Error) => {
                this.logger.warn('Client socket error', { err: err.message })
            })
            // CSWSH defense: if an origin allowlist is configured, reject any
            // browser Origin not on it. Non-browser clients send no Origin (allowed).
            const allowed = this.opts.allowedOrigins
            const origin = req.headers.origin
            if (allowed && origin !== undefined && !allowed.includes(origin)) {
                this.logger.warn('Connection rejected — origin not allowed', { origin })
                ws.close(CloseCode.PolicyViolation, CloseReason.AuthFailed)
                return
            }
            if (this._connections >= this.maxConnections) {
                this.logger.warn('Connection rejected — server at capacity', {
                    connections: this._connections,
                })
                ws.close(CloseCode.PolicyViolation, CloseReason.ServerAtCapacity)
                return
            }
            this._connections++
            ws.once('close', () => {
                this._connections--
            })
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

    /**
     * Gracefully shuts the server down.
     *
     * @remarks
     * Stops the heartbeat, disposes the cluster {@link RoomRouter} (if any),
     * disconnects every peer with {@link CloseReason.ServerStopping}, and closes
     * the WebSocket server (and the owned HTTP server, if one was created).
     * Idempotent — calling it more than once is a no-op.
     *
     * @returns A promise that resolves once all sockets are closed.
     * @throws If closing the WebSocket or HTTP server errors.
     */
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

        this.wss = undefined
        this.ownServer = undefined
        this.logger.info('SignalingServer stopped')
    }

    /**
     * The TCP port the server is actually listening on, or `undefined` before
     * {@link SignalingServer.start} resolves. Resolves the OS-assigned port when
     * the server was created with `port: 0`.
     */
    get port(): number | undefined {
        const addr = this.ownServer?.address()
        if (addr && typeof addr === 'object') return addr.port
        return this.startedAt > 0 ? (this.opts.port ?? 3000) : undefined
    }

    /**
     * Looks up a room currently held by this server instance.
     *
     * @param roomId - The room id.
     * @returns The {@link Room}, or `undefined` if no such room exists locally.
     */
    getRoom(roomId: string): Room | undefined {
        return this.registry.get(roomId)
    }

    /**
     * Resolves which cluster node owns a given room.
     *
     * @param roomId - The room id to route.
     * @returns The owning {@link NodeInfo}, or `undefined` when cluster mode is
     *   not enabled or the owner is unknown.
     */
    getOwner(roomId: string): NodeInfo | undefined {
        return this.router?.owner(roomId)
    }

    /**
     * Returns a snapshot of current server activity.
     *
     * @returns Live room count, peer count, and uptime. See {@link ServerStats}.
     */
    getStats(): ServerStats {
        return {
            rooms: this.registry.size,
            peers: this.registry.totalPeers(),
            uptime: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
        }
    }

    /**
     * Registers a JSON health endpoint on an existing HTTP server.
     *
     * @remarks
     * Responds to `GET {path}` with `200` and a body of
     * `{ status: 'ok', ...ServerStats }`. Other methods and paths are ignored,
     * so this can be attached alongside your own request handlers.
     *
     * @param server - The HTTP server to add the listener to.
     * @param path - The URL path to serve. @defaultValue `'/health'`
     *
     * @example
     * ```ts
     * import http from 'node:http'
     * const httpServer = http.createServer()
     * const server = new SignalingServer({ server: httpServer })
     * server.attachHealthEndpoint(httpServer, '/healthz')
     * httpServer.listen(3000)
     * // GET /healthz -> { "status": "ok", "rooms": 0, "peers": 0, "uptime": 0 }
     * ```
     */
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

        // Reject connections that would create a new room past the global cap.
        if (!this.registry.get(roomId) && this.registry.size >= this.maxRooms) {
            this.logger.warn('Connection rejected — room cap reached', {
                roomId,
                rooms: this.registry.size,
            })
            ws.close(CloseCode.PolicyViolation, CloseReason.ServerAtCapacity)
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
            maxMessagesPerSecond: this.effectiveRateLimit,
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
