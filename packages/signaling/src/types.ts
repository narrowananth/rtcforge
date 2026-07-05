import type { Server } from 'node:http'
import { Metric, noopLogger, noopMetrics } from 'rtcforge-core'
import type { Logger, Membership, MetricsCollector, NodeInfo } from 'rtcforge-core'
import { z } from 'zod'

/**
 * Structured logging sink used across the signaling server.
 *
 * @remarks
 * Re-exported from `rtcforge-core`. Supply your own implementation via
 * {@link SignalingServerOptions.logger} to forward server lifecycle, peer,
 * and error logs into your logging stack; defaults to {@link noopLogger}.
 */
export type { Logger }
/**
 * Counter/gauge sink for operational telemetry.
 *
 * @remarks
 * Re-exported from `rtcforge-core`. Supply your own implementation via
 * {@link SignalingServerOptions.metrics} to export the {@link Metric} series
 * (peer/room counts, relayed signals, auth errors) to Prometheus, StatsD, or
 * similar; defaults to {@link noopMetrics}.
 */
export type { MetricsCollector }
/**
 * Live view of the cluster's node roster.
 *
 * @remarks
 * Re-exported from `rtcforge-core`. Passed as {@link SignalingServerOptions.cluster}'s
 * `membership` and consumed by {@link RoomRouter} to keep its consistent-hash
 * ring in sync as nodes join and leave.
 */
export type { Membership }
/**
 * Descriptor for a single node in a signaling cluster: its stable id and
 * optional metadata (e.g. `{ capacity }`, which weights the hash ring).
 *
 * @remarks
 * Re-exported from `rtcforge-core`. Returned by {@link RoomRouter.owner} and
 * {@link SignalingServer.getOwner} to identify which node owns a room.
 */
export type { NodeInfo }
/**
 * No-op {@link Logger} that discards every log call. Default logger when
 * {@link SignalingServerOptions.logger} is not provided.
 */
export { noopLogger }
/**
 * No-op {@link MetricsCollector} that discards every metric. Default collector
 * when {@link SignalingServerOptions.metrics} is not provided.
 */
export { noopMetrics }
/**
 * Canonical metric names emitted by the signaling server. Each value is the
 * stable string key reported through the configured {@link MetricsCollector}.
 *
 * @remarks
 * Re-exported from `rtcforge-core`. Emitted keys include `peers_connected`,
 * `peers_disconnected`, `peers_kicked`, `rooms_created`, `rooms_closed`,
 * `signals_relayed`, `broadcasts_relayed`, `auth_errors`, and the gauges
 * `active_rooms` and `active_peers`.
 */
export { Metric }

/**
 * Zod schema that validates the payload an {@link AuthFunction} must resolve
 * to. Requires a non-empty `roomId` and `peerId`, a `role` string, and an
 * optional flat string→string `metadata` record.
 */
export const AuthPayloadSchema = z.object({
    roomId: z.string().min(1),
    peerId: z.string().min(1),
    role: z.string(),
    metadata: z.record(z.string(), z.string()).optional(),
})

/**
 * Identity and placement of an authenticated peer, produced by an
 * {@link AuthFunction} and validated against `AuthPayloadSchema`.
 */
export type AuthPayload = z.infer<typeof AuthPayloadSchema>

/**
 * Application-supplied hook that verifies a client's connection token and
 * resolves the peer's identity.
 *
 * @remarks
 * Configured via {@link SignalingServerOptions.auth}. The server passes the
 * token extracted from the incoming WebSocket upgrade request (query string or
 * `Authorization` header). Resolve to an {@link AuthPayload} to admit the peer;
 * reject (throw) to deny it — the connection is then closed with
 * {@link CloseCode.PolicyViolation} and {@link CloseReason.AuthFailed}, and an
 * `auth_errors` metric is emitted. This is the single trust boundary for the
 * server: room membership, role, and metadata are all derived from what this
 * function returns, so it must not be omitted in production.
 *
 * @param token - The opaque credential presented by the connecting client.
 * @returns The authenticated peer's room, id, role, and optional metadata.
 * @throws When the token is invalid or the client is not authorized to join.
 *
 * @example
 * ```ts
 * const auth: AuthFunction = async (token) => {
 *   const claims = await verifyJwt(token) // your verifier
 *   return {
 *     roomId: claims.room,
 *     peerId: claims.sub,
 *     role: claims.role,
 *     metadata: { name: claims.name },
 *   }
 * }
 * const server = new SignalingServer({ port: 3000, auth })
 * ```
 */
export type AuthFunction = (token: string) => Promise<AuthPayload>

/**
 * Lifecycle states of a {@link Room}. A room advances forward only:
 * `creating → active → closing → closed`.
 */
export const RoomState = {
    /** Room object exists but no peer has successfully joined yet. */
    Creating: 'creating',
    /** At least one peer is present; the room is relaying and broadcasting. */
    Active: 'active',
    /** Room is tearing down (last peer left, expired, or disposed). */
    Closing: 'closing',
    /** Terminal state; the room has emitted {@link RoomEvent.Closed} and holds no peers. */
    Closed: 'closed',
} as const

/**
 * Union of the {@link RoomState} string values.
 */
export type RoomState = (typeof RoomState)[keyof typeof RoomState]

/**
 * Names of the events emitted by a {@link Room} instance.
 */
export const RoomEvent = {
    /** A peer joined (or reconnected into) the room. Payload: the {@link Peer}. */
    PeerJoined: 'peerJoined',
    /** A peer left the room, was replaced, kicked, or the room closed. Payload: the {@link Peer}. */
    PeerLeft: 'peerLeft',
    /** The room reached {@link RoomState.Closed} and holds no peers. */
    Closed: 'closed',
    /** Sending a message to a peer failed. Payload: `(peerId, error)`. */
    PeerError: 'peerError',
    /** A peer was forcibly removed via {@link Room.kickPeer}. Payload: `(peerId, reason?)`. */
    PeerKicked: 'peerKicked',
} as const

/**
 * Union of the {@link RoomEvent} names.
 */
export type RoomEvent = (typeof RoomEvent)[keyof typeof RoomEvent]

/**
 * Names of the events emitted by a {@link SignalingServer} instance.
 */
export const ServerEvent = {
    /** First peer created a new room. Payload: the {@link Room}. */
    RoomCreated: 'roomCreated',
    /** A room closed and was removed from the registry. Payload: the `roomId`. */
    RoomClosed: 'roomClosed',
    /** The underlying WebSocket server raised an error. Payload: the `Error`. */
    Error: 'error',
} as const

/**
 * Union of the {@link ServerEvent} names.
 */
export type ServerEvent = (typeof ServerEvent)[keyof typeof ServerEvent]

/**
 * Names of the events emitted by a {@link Peer} instance.
 */
export const PeerEvent = {
    /** The peer's WebSocket closed. Payload: `(code, reason)`. */
    Disconnected: 'disconnected',
    /** The peer sent a directed signal. Payload: `(to, data)`. */
    Signal: 'signal',
    /** The peer requested a room-wide broadcast. Payload: `(channel, data)`. */
    Broadcast: 'broadcast',
    /** An inbound message failed to parse/validate, or a send failed. Payload: the `Error`. */
    Error: 'error',
    /** An inbound message was dropped because the peer exceeded its rate limit. */
    RateLimitExceeded: 'rate-limit-exceeded',
    /** The peer answered a heartbeat ping; `lastPong` was refreshed. */
    Pong: 'pong',
} as const

/**
 * Union of the {@link PeerEvent} names.
 */
export type PeerEvent = (typeof PeerEvent)[keyof typeof PeerEvent]

/**
 * WebSocket close codes the server uses when disconnecting peers.
 */
export const CloseCode = {
    /** RFC 6455 normal closure (1000): orderly shutdown, e.g. reconnection or room expiry. */
    Normal: 1000,
    /** RFC 6455 going-away (1001): endpoint is leaving. */
    GoingAway: 1001,
    /** RFC 6455 policy violation (1008): auth failure, rate/room-full rejection, wrong-node redirect, or kick. */
    PolicyViolation: 1008,
} as const

/**
 * Union of the {@link CloseCode} numeric values.
 */
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode]

/**
 * Human-readable reason strings paired with a {@link CloseCode} on the WebSocket
 * close frame, so clients can distinguish why they were disconnected.
 */
export const CloseReason = {
    /** A newer connection with the same peer id replaced this one. */
    ReplacedByReconnection: 'Replaced by reconnection',
    /** The peer missed the pong deadline and was pruned by the heartbeat monitor. */
    HeartbeatTimeout: 'Heartbeat timeout',
    /** The auth payload lacked a `roomId` or `peerId`. */
    MissingRoomOrPeer: 'Missing roomId or peerId',
    /** The auth payload failed `AuthPayloadSchema` validation. */
    InvalidAuthPayload: 'Invalid auth payload',
    /** The {@link AuthFunction} rejected the token. */
    AuthFailed: 'Auth failed',
    /** The server is shutting down via {@link SignalingServer.stop}. */
    ServerStopping: 'Server stopping',
    /** The peer was removed via {@link Room.kickPeer} without a custom reason. */
    Kicked: 'Kicked from room',
    /** The room already holds `maxPeersPerRoom` peers. */
    RoomFull: 'Room is full',
    /** The room closed (last peer left) while this peer's join was in flight. */
    RoomClosing: 'Room is closing',
    /** The server is at its global connection cap. */
    ServerAtCapacity: 'Server at capacity',
    /** The peer's outbound send buffer exceeded its cap (slow/stalled consumer). */
    SendBufferOverflow: 'Send buffer overflow',
    /** In cluster mode, this room is owned by another node; the client should reconnect to the owner. */
    WrongNode: 'Room owned by another node — reconnect to owner',
} as const

/**
 * Union of the {@link CloseReason} strings.
 */
export type CloseReason = (typeof CloseReason)[keyof typeof CloseReason]

/**
 * Discriminator for an {@link AuditEvent}, naming the lifecycle transition that
 * occurred.
 */
export type AuditEventType =
    | 'peer-joined'
    | 'peer-left'
    | 'peer-kicked'
    | 'room-created'
    | 'room-closed'

/**
 * A single security/compliance audit record delivered to
 * {@link SignalingServerOptions.auditLog} on room and peer lifecycle
 * transitions.
 */
export interface AuditEvent {
    /** Which lifecycle transition this record describes. */
    type: AuditEventType
    /** Id of the room the event pertains to. */
    roomId: string
    /** Id of the peer involved, when the event is peer-scoped. */
    peerId?: string
    /** Wall-clock time of the event, in epoch milliseconds. */
    ts: number
    /** Optional extra context (e.g. `{ reason }` on a `peer-kicked` event). */
    detail?: Record<string, unknown>
}

/**
 * A WebRTC ICE server entry, shaped to match the browser
 * `RTCIceServer` dictionary. Returned by
 * {@link SignalingServerOptions.iceServersHook} and forwarded to the joining
 * peer in its `room-joined` message.
 */
export interface IceServerConfig {
    /** One or more STUN/TURN URLs, e.g. `"stun:stun.l.google.com:19302"`. */
    urls: string | string[]
    /** TURN username, when the server requires credentials. */
    username?: string
    /** TURN credential/password paired with {@link IceServerConfig.username}. */
    credential?: string
}

/**
 * Configuration for a {@link SignalingServer}. Every field is optional; an empty
 * object yields an unauthenticated server listening on port 3000 with default
 * heartbeat timings.
 *
 * @remarks
 * For production deployments you will almost always set {@link SignalingServerOptions.auth}.
 * See {@link SignalingServerOptions.cluster} to enable horizontal sharding via
 * {@link RoomRouter}.
 */
export interface SignalingServerOptions {
    /** TCP port to listen on when the server creates its own HTTP server. @defaultValue `3000` */
    port?: number
    /**
     * Existing Node HTTP server to attach the WebSocket server to instead of
     * creating one. Takes precedence over {@link SignalingServerOptions.port}.
     */
    server?: Server
    /**
     * Token verification hook. When omitted, connections are admitted using
     * whatever identity the transport supplies — do not omit in production.
     * See {@link AuthFunction}.
     */
    auth?: AuthFunction
    /**
     * Hard cap on concurrent peers per room; excess peers are closed with
     * {@link CloseReason.RoomFull}. Bounded out of the box; raise it for larger
     * rooms. @defaultValue `100`
     */
    maxPeersPerRoom?: number
    /**
     * Maximum inbound WebSocket message size in bytes; larger frames are
     * rejected by `ws` before reaching application code. Blunts memory-exhaustion
     * floods. @defaultValue `262144` (256 KiB)
     */
    maxPayloadBytes?: number
    /**
     * Hard cap on total concurrent connections across all rooms. Connections
     * beyond the cap are closed with {@link CloseReason.ServerAtCapacity}.
     * @defaultValue `10000`
     */
    maxConnections?: number
    /**
     * Hard cap on the number of concurrent rooms. A connection that would create
     * a new room past this cap is rejected. @defaultValue `10000`
     */
    maxRooms?: number
    /** Maximum lifetime of a room in milliseconds; on expiry all peers are disconnected and the room closes. */
    roomMaxDurationMs?: number
    /** Idle timeout in milliseconds; a room with no relay/broadcast activity for this long is closed. */
    roomIdleTimeoutMs?: number
    /** Interval in milliseconds between heartbeat pings sent to each peer. @defaultValue `30000` */
    pingInterval?: number
    /** Grace period in milliseconds after which a peer that has not ponged is pruned. @defaultValue `60000` */
    pongTimeout?: number
    /** Structured log sink. @defaultValue {@link noopLogger} */
    logger?: Logger
    /** Metrics sink. @defaultValue {@link noopMetrics} */
    metrics?: MetricsCollector
    /** When `true`, the server assigns each peer's id rather than trusting the client-supplied id. */
    serverAssignedPeerId?: boolean
    /**
     * Allowlist of `Origin` header values that may connect (CSWSH defense for
     * browser clients). A connection whose `Origin` is not listed is closed with
     * {@link CloseCode.PolicyViolation}. Omit to allow any origin (non-browser
     * clients typically send no `Origin`, which is always allowed).
     */
    allowedOrigins?: string[]
    /**
     * Per-peer inbound rate limiting. Enabled by default at 100 msg/s; set
     * `maxMessagesPerSecond` to `0` (or a negative value) to disable.
     */
    rateLimit?: {
        /**
         * Maximum inbound messages per second per peer; excess messages are
         * dropped and {@link PeerEvent.RateLimitExceeded} fires. `0` or negative
         * disables the limiter. @defaultValue `100`
         */
        maxMessagesPerSecond?: number
    }
    /** Sink for {@link AuditEvent}s covering peer and room lifecycle transitions. */
    auditLog?: (event: AuditEvent) => void
    /**
     * Hook to supply per-connection ICE servers (e.g. short-lived TURN
     * credentials) sent to the joining peer. Return `null`/`undefined` to omit
     * ICE servers for that peer. May be async.
     *
     * @param peerId - Id of the joining peer.
     * @param roomId - Id of the room being joined.
     * @returns The ICE servers to advertise, or nothing.
     */
    iceServersHook?: (
        peerId: string,
        roomId: string,
    ) => IceServerConfig[] | null | undefined | Promise<IceServerConfig[] | null | undefined>
    /**
     * Enables cluster mode. When set, the server constructs a {@link RoomRouter}
     * and routes each room to its owning node; connections for rooms owned by
     * another node are redirected. See {@link RoomRouter} for the sharding flow.
     */
    cluster?: {
        /** Stable id of this node within the cluster. */
        selfId: string
        /** Live roster of cluster nodes used to build the hash ring. */
        membership: Membership
    }
    /**
     * Called when an incoming connection targets a room owned by another node,
     * just before the connection is closed with {@link CloseReason.WrongNode}.
     * Use it to inform the client (or a load balancer) of the correct owner.
     *
     * @param peerId - Id of the peer that was redirected.
     * @param roomId - Id of the room it tried to join.
     * @param owner - The node that owns the room, if known.
     */
    onRedirect?: (peerId: string, roomId: string, owner: NodeInfo | undefined) => void
}
