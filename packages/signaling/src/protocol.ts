import { z } from 'zod'

export const MessageType = {
    RoomJoined: 'room-joined',
    PeerJoined: 'peer-joined',
    PeerLeft: 'peer-left',
    Signal: 'signal',
    Error: 'error',
    Ping: 'ping',
    Pong: 'pong',
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export const ClientMessageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal(MessageType.Signal), to: z.string(), data: z.unknown() }),
    z.object({ type: z.literal(MessageType.Pong) }),
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>

export const ServerMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal(MessageType.RoomJoined),
        roomId: z.string(),
        peerId: z.string(),
        peers: z.array(z.string()),
    }),
    z.object({ type: z.literal(MessageType.PeerJoined), peerId: z.string() }),
    z.object({ type: z.literal(MessageType.PeerLeft), peerId: z.string() }),
    z.object({ type: z.literal(MessageType.Signal), from: z.string(), data: z.unknown() }),
    z.object({ type: z.literal(MessageType.Error), code: z.string(), message: z.string() }),
    z.object({ type: z.literal(MessageType.Ping) }),
])

export type ServerMessage = z.infer<typeof ServerMessageSchema>
