import { z } from 'zod'

export const MessageType = {
    RoomJoined: 'room-joined',
    PeerJoined: 'peer-joined',
    PeerLeft: 'peer-left',
    PresenceOnline: 'presence-online',
    PresenceOffline: 'presence-offline',
    Signal: 'signal',
    Broadcast: 'broadcast',
    Error: 'error',
    Ping: 'ping',
    Pong: 'pong',
    Kicked: 'kicked',
    RoleChanged: 'role-changed',
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

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

export type ServerMessage = z.infer<typeof ServerMessageSchema>

export const ClientMessageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal(MessageType.Signal), to: z.string(), data: z.unknown() }),
    z.object({ type: z.literal(MessageType.Pong) }),
    z.object({
        type: z.literal(MessageType.Broadcast),
        channel: z.string().min(1),
        data: z.unknown().optional(),
    }),
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>
