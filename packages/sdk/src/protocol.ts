import { z } from 'zod'

/**
 * Signaling wire protocol version this client speaks. Compared against the
 * server's `v` on `room-joined`; a mismatch is surfaced so a skew fails fast
 * instead of hanging on silently-dropped, newer-shaped frames.
 */
export const PROTOCOL_VERSION = 1

/**
 * Discriminator values for every message exchanged over the signaling
 * {@link Transport}. Each value is the `type` field of a wire message; the same
 * constant is reused as the event name emitted by {@link Room} for the
 * corresponding server message.
 *
 * @remarks
 * `Ping`/`Pong` are handled internally by {@link WebSocketTransport} as a
 * keep-alive and never surface to application code.
 */
export const MessageType = {
    /** Server confirms the local peer has joined a room; carries the roster, roles, metadata and ICE servers. */
    RoomJoined: 'room-joined',
    /** A remote peer joined the room. */
    PeerJoined: 'peer-joined',
    /** A remote peer left the room. */
    PeerLeft: 'peer-left',
    /** A known peer came online (regained its connection). */
    PresenceOnline: 'presence-online',
    /** A known peer went offline (lost its connection but has not left). */
    PresenceOffline: 'presence-offline',
    /** Directed peer-to-peer signaling payload (e.g. SDP/ICE), routed via the server. */
    Signal: 'signal',
    /** Fan-out message delivered to every peer subscribed to a named channel. */
    Broadcast: 'broadcast',
    /** Server-reported error carrying a machine `code` and human-readable `message`. */
    Error: 'error',
    /** Server keep-alive request; answered automatically with {@link MessageType.Pong}. */
    Ping: 'ping',
    /** Client keep-alive reply to a {@link MessageType.Ping}. */
    Pong: 'pong',
    /** The local peer was forcibly removed from the room by the server. */
    Kicked: 'kicked',
    /** A peer's role changed. */
    RoleChanged: 'role-changed',
} as const

/** Union of the string discriminator values in {@link MessageType}. */
export type MessageType = (typeof MessageType)[keyof typeof MessageType]

/**
 * Zod schema validating every inbound message from the signaling server.
 *
 * @remarks
 * {@link WebSocketTransport} parses each frame with this schema and silently
 * drops any message that fails validation, so malformed server output can never
 * reach application code.
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal(MessageType.RoomJoined),
        /** Server's signaling protocol version; compared against {@link PROTOCOL_VERSION}. */
        v: z.number().int().optional(),
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

/** A validated message received from the signaling server. */
export type ServerMessage = z.infer<typeof ServerMessageSchema>

/**
 * Zod schema for messages the client is permitted to send to the server:
 * directed signals, broadcasts, and the keep-alive pong.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal(MessageType.Signal), to: z.string(), data: z.unknown() }),
    z.object({ type: z.literal(MessageType.Pong) }),
    z.object({
        type: z.literal(MessageType.Broadcast),
        channel: z.string().min(1),
        data: z.unknown().optional(),
    }),
])

/** A message sent from the client to the signaling server. */
export type ClientMessage = z.infer<typeof ClientMessageSchema>
