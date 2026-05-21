import { z } from 'zod'

export const MessageType = {
    RoomJoined: 'room-joined',
    PeerJoined: 'peer-joined',
    PeerLeft: 'peer-left',
    PresenceOnline: 'presence-online',
    PresenceOffline: 'presence-offline',
    Signal: 'signal',
    Error: 'error',
    Ping: 'ping',
    Pong: 'pong',
    Chat: 'chat',
    Typing: 'typing',
    History: 'history',
    Delivered: 'delivered',
    Read: 'read',
    Edit: 'edit',
    Delete: 'delete',
    Edited: 'edited',
    Deleted: 'deleted',
    Reaction: 'reaction',
    Kicked: 'kicked',
    WhiteboardEvent: 'whiteboard-event',
    WhiteboardSync: 'whiteboard-sync',
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export const MediaAttachmentSchema = z.object({
    url: z.string().url(),
    mimeType: z.string(),
    size: z.number().int().positive(),
    filename: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    duration: z.number().positive().optional(),
    thumbnailUrl: z.string().url().optional(),
})

export type MediaAttachment = z.infer<typeof MediaAttachmentSchema>

const StoredMessageSchema = z.object({
    id: z.string(),
    seq: z.number(),
    from: z.string(),
    text: z.string().optional(),
    ts: z.number(),
    to: z.union([z.string(), z.array(z.string())]).optional(),
    replyTo: z.string().optional(),
    editedAt: z.number().optional(),
    attachments: z.array(MediaAttachmentSchema).optional(),
})

export const ClientMessageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal(MessageType.Signal), to: z.string(), data: z.unknown() }),
    z.object({ type: z.literal(MessageType.Pong) }),
    z.object({
        type: z.literal(MessageType.Chat),
        text: z.string().max(4096).optional(),
        to: z.union([z.string(), z.array(z.string()).min(1).max(100)]).optional(),
        replyTo: z.string().optional(),
        attachments: z.array(MediaAttachmentSchema).min(1).max(10).optional(),
    }),
    z.object({ type: z.literal(MessageType.Typing) }),
    z.object({
        type: z.literal(MessageType.Edit),
        id: z.string(),
        text: z.string().min(1).max(4096),
    }),
    z.object({ type: z.literal(MessageType.Delete), id: z.string() }),
    z.object({
        type: z.literal(MessageType.Reaction),
        msgId: z.string(),
        emoji: z.string().min(1).max(8),
    }),
    z.object({ type: z.literal(MessageType.Read), id: z.string() }),
    z.object({
        type: z.literal(MessageType.WhiteboardEvent),
        eventType: z.string().min(1).max(64),
        data: z.unknown().optional(),
    }),
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
    z.object({ type: z.literal(MessageType.PresenceOnline), peerId: z.string() }),
    z.object({ type: z.literal(MessageType.PresenceOffline), peerId: z.string() }),
    z.object({
        type: z.literal(MessageType.Kicked),
        peerId: z.string(),
        reason: z.string().optional(),
    }),
    z.object({ type: z.literal(MessageType.Signal), from: z.string(), data: z.unknown() }),
    z.object({ type: z.literal(MessageType.Error), code: z.string(), message: z.string() }),
    z.object({ type: z.literal(MessageType.Ping) }),
    z.object({
        type: z.literal(MessageType.Chat),
        from: z.string(),
        text: z.string().optional(),
        id: z.string(),
        ts: z.number(),
        seq: z.number(),
        to: z.union([z.string(), z.array(z.string())]).optional(),
        replyTo: z.string().optional(),
        attachments: z.array(MediaAttachmentSchema).optional(),
    }),
    z.object({ type: z.literal(MessageType.Typing), peerId: z.string() }),
    z.object({ type: z.literal(MessageType.History), messages: z.array(StoredMessageSchema) }),
    z.object({ type: z.literal(MessageType.Delivered), id: z.string() }),
    z.object({ type: z.literal(MessageType.Read), id: z.string(), by: z.string() }),
    z.object({
        type: z.literal(MessageType.Edited),
        id: z.string(),
        text: z.string(),
        editedAt: z.number(),
        by: z.string(),
    }),
    z.object({ type: z.literal(MessageType.Deleted), id: z.string(), by: z.string() }),
    z.object({
        type: z.literal(MessageType.Reaction),
        msgId: z.string(),
        emoji: z.string(),
        by: z.string(),
    }),
    z.object({
        type: z.literal(MessageType.WhiteboardEvent),
        from: z.string(),
        eventType: z.string(),
        data: z.unknown().optional(),
        seq: z.number(),
        ts: z.number(),
    }),
    z.object({ type: z.literal(MessageType.WhiteboardSync), state: z.unknown() }),
])

export type ServerMessage = z.infer<typeof ServerMessageSchema>
