import { EventEmitter } from './EventEmitter.js'
import type { WebSocketTransport } from './WebSocketTransport.js'
import { MessageType } from './protocol.js'
import type { ClientMessage, MediaAttachment, ServerMessage } from './protocol.js'

export type { MediaAttachment }

export const ChatRoomEvent = {
    Message: 'message',
    Typing: 'typing',
    History: 'history',
    Delivered: 'delivered',
    Read: 'read',
    Edited: 'edited',
    Deleted: 'deleted',
    Reaction: 'reaction',
} as const

export type ChatRoomEvent = (typeof ChatRoomEvent)[keyof typeof ChatRoomEvent]

export interface ChatMessage {
    id: string
    seq: number
    from: string
    text?: string
    ts: number
    to?: string | string[]
    replyTo?: string
    editedAt?: number
    attachments?: MediaAttachment[]
}

type ChatRoomEvents = {
    [ChatRoomEvent.Message]: [msg: ChatMessage]
    [ChatRoomEvent.Typing]: [peerId: string]
    [ChatRoomEvent.History]: [messages: ChatMessage[]]
    [ChatRoomEvent.Delivered]: [id: string]
    [ChatRoomEvent.Read]: [id: string, by: string]
    [ChatRoomEvent.Edited]: [id: string, text: string, editedAt: number, by: string]
    [ChatRoomEvent.Deleted]: [id: string, by: string]
    [ChatRoomEvent.Reaction]: [msgId: string, emoji: string, by: string]
}

export class ChatRoom extends EventEmitter<ChatRoomEvents> {
    private readonly _transport: WebSocketTransport

    constructor(transport: WebSocketTransport) {
        super()
        this._transport = transport
    }

    send(
        text?: string,
        opts?: { to?: string | string[]; replyTo?: string; attachments?: MediaAttachment[] },
    ): void {
        if (!text && !opts?.attachments?.length) {
            throw new Error('Message must have text or at least one attachment')
        }
        const msg: ClientMessage = {
            type: MessageType.Chat,
            text,
            to: opts?.to,
            replyTo: opts?.replyTo,
            attachments: opts?.attachments,
        }
        this._transport.send(msg)
    }

    sendTyping(): void {
        this._transport.send({ type: MessageType.Typing } satisfies ClientMessage)
    }

    sendEdit(id: string, text: string): void {
        this._transport.send({ type: MessageType.Edit, id, text } satisfies ClientMessage)
    }

    sendDelete(id: string): void {
        this._transport.send({ type: MessageType.Delete, id } satisfies ClientMessage)
    }

    sendReaction(msgId: string, emoji: string): void {
        this._transport.send({ type: MessageType.Reaction, msgId, emoji } satisfies ClientMessage)
    }

    sendRead(id: string): void {
        this._transport.send({ type: MessageType.Read, id } satisfies ClientMessage)
    }

    _handleMessage(msg: ServerMessage): void {
        switch (msg.type) {
            case MessageType.Chat:
                this.emit(ChatRoomEvent.Message, {
                    id: msg.id,
                    seq: msg.seq,
                    from: msg.from,
                    text: msg.text,
                    ts: msg.ts,
                    to: msg.to,
                    replyTo: msg.replyTo,
                    attachments: msg.attachments,
                })
                break
            case MessageType.Typing:
                this.emit(ChatRoomEvent.Typing, msg.peerId)
                break
            case MessageType.History:
                this.emit(ChatRoomEvent.History, msg.messages as ChatMessage[])
                break
            case MessageType.Delivered:
                this.emit(ChatRoomEvent.Delivered, msg.id)
                break
            case MessageType.Read:
                this.emit(ChatRoomEvent.Read, msg.id, msg.by)
                break
            case MessageType.Edited:
                this.emit(ChatRoomEvent.Edited, msg.id, msg.text, msg.editedAt, msg.by)
                break
            case MessageType.Deleted:
                this.emit(ChatRoomEvent.Deleted, msg.id, msg.by)
                break
            case MessageType.Reaction:
                this.emit(ChatRoomEvent.Reaction, msg.msgId, msg.emoji, msg.by)
                break
        }
    }
}
