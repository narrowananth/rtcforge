import { z } from 'zod'

/**
 * The `type` discriminator carried by every wire message exchanged over the
 * signaling WebSocket. Some values flow server→client, some client→server, and
 * a few both ways (see {@link ServerMessage} and {@link ClientMessage}).
 */
export const MessageType = {
    /** Server→client. Sent once on join with the room roster, roles, metadata, and ICE servers. */
    RoomJoined: 'room-joined',
    /** Server→client. A new peer joined the room. */
    PeerJoined: 'peer-joined',
    /** Server→client. A peer left the room. */
    PeerLeft: 'peer-left',
    /** Server→client. A peer became reachable (presence up). */
    PresenceOnline: 'presence-online',
    /** Server→client. A peer became unreachable (presence down). */
    PresenceOffline: 'presence-offline',
    /** Both directions. A directed peer-to-peer signal (SDP/ICE payload). */
    Signal: 'signal',
    /** Both directions. A room-wide fan-out message on a named channel. */
    Broadcast: 'broadcast',
    /** Server→client. A protocol or application error. */
    Error: 'error',
    /** Server→client. Heartbeat probe; the client must answer with {@link MessageType.Pong}. */
    Ping: 'ping',
    /** Client→server. Heartbeat response to a {@link MessageType.Ping}. */
    Pong: 'pong',
    /** Server→client. The peer was forcibly removed from the room. */
    Kicked: 'kicked',
    /** Server→client. A peer's role changed. */
    RoleChanged: 'role-changed',
} as const

/**
 * Union of the {@link MessageType} string values.
 */
export type MessageType = (typeof MessageType)[keyof typeof MessageType]

/**
 * Zod schema validating messages sent by clients to the server. A parsed value
 * is a {@link ClientMessage}: a directed `signal`, a heartbeat `pong`, or a
 * `broadcast`. Malformed inbound messages are rejected and surface as
 * {@link PeerEvent.Error}.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal(MessageType.Signal),
        to: z.string(),
        data: z.unknown(),
    }),
    z.object({ type: z.literal(MessageType.Pong) }),
    z.object({
        type: z.literal(MessageType.Broadcast),
        channel: z.string().min(1),
        data: z.unknown().optional(),
    }),
])

/**
 * A validated message sent from a client to the server: a directed
 * {@link MessageType.Signal}, a {@link MessageType.Pong} heartbeat reply, or a
 * {@link MessageType.Broadcast} on a named channel.
 */
export type ClientMessage = z.infer<typeof ClientMessageSchema>

/**
 * Zod schema describing every message the server sends to a client. A parsed
 * value is a {@link ServerMessage}.
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal(MessageType.RoomJoined),
        roomId: z.string(),
        peerId: z.string(),
        peers: z.array(z.string()),
        peerRoles: z.record(z.string(), z.string()).optional(),
        peerMetadata: z.record(z.string(), z.record(z.string(), z.string())).optional(),
        localRole: z.string().optional(),
        iceServers: z
            .array(
                z.object({
                    urls: z.union([z.string(), z.array(z.string())]),
                    username: z.string().optional(),
                    credential: z.string().optional(),
                }),
            )
            .optional(),
    }),
    z.object({
        type: z.literal(MessageType.PeerJoined),
        peerId: z.string(),
        role: z.string().optional(),
        metadata: z.record(z.string(), z.string()).optional(),
    }),
    z.object({ type: z.literal(MessageType.PeerLeft), peerId: z.string() }),
    z.object({ type: z.literal(MessageType.PresenceOnline), peerId: z.string() }),
    z.object({ type: z.literal(MessageType.PresenceOffline), peerId: z.string() }),
    z.object({
        type: z.literal(MessageType.Kicked),
        peerId: z.string(),
        reason: z.string().optional(),
    }),
    z.object({ type: z.literal(MessageType.Signal), from: z.string(), data: z.unknown() }),
    z.object({
        type: z.literal(MessageType.Broadcast),
        from: z.string(),
        channel: z.string(),
        data: z.unknown().optional(),
        ts: z.number(),
    }),
    z.object({ type: z.literal(MessageType.Error), code: z.string(), message: z.string() }),
    z.object({ type: z.literal(MessageType.Ping) }),
    z.object({ type: z.literal(MessageType.RoleChanged), peerId: z.string(), role: z.string() }),
])

/**
 * A message sent from the server to a client. The `type` field discriminates
 * the variant; see {@link MessageType} for the meaning of each. Variants
 * include `room-joined` (initial roster + ICE servers), `peer-joined`,
 * `peer-left`, `presence-online`/`presence-offline`, `signal`, `broadcast`,
 * `error`, `ping`, `kicked`, and `role-changed`.
 */
export type ServerMessage = z.infer<typeof ServerMessageSchema>
