import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { ClientMessageSchema, MessageType } from './protocol.js'
import type { MediaAttachment, ServerMessage } from './protocol.js'
import { PeerEvent } from './types.js'
import type { PeerRole } from './types.js'

export declare interface Peer {
    on(event: typeof PeerEvent.Disconnected, listener: (code: number, reason: string) => void): this
    on(
        event: typeof PeerEvent.Chat,
        listener: (
            text: string | undefined,
            to?: string | string[],
            replyTo?: string,
            attachments?: MediaAttachment[],
        ) => void,
    ): this
    on(event: typeof PeerEvent.Typing, listener: () => void): this
    on(event: typeof PeerEvent.Edit, listener: (id: string, text: string) => void): this
    on(event: typeof PeerEvent.Delete, listener: (id: string) => void): this
    on(event: typeof PeerEvent.Reaction, listener: (msgId: string, emoji: string) => void): this
    on(event: typeof PeerEvent.Read, listener: (id: string) => void): this
    on(
        event: typeof PeerEvent.WhiteboardEvent,
        listener: (eventType: string, data: unknown) => void,
    ): this
    once(
        event: typeof PeerEvent.Disconnected,
        listener: (code: number, reason: string) => void,
    ): this
    once(
        event: typeof PeerEvent.Chat,
        listener: (
            text: string | undefined,
            to?: string | string[],
            replyTo?: string,
            attachments?: MediaAttachment[],
        ) => void,
    ): this
    once(event: typeof PeerEvent.Typing, listener: () => void): this
    once(event: typeof PeerEvent.Edit, listener: (id: string, text: string) => void): this
    once(event: typeof PeerEvent.Delete, listener: (id: string) => void): this
    once(event: typeof PeerEvent.Reaction, listener: (msgId: string, emoji: string) => void): this
    once(event: typeof PeerEvent.Read, listener: (id: string) => void): this
    once(
        event: typeof PeerEvent.WhiteboardEvent,
        listener: (eventType: string, data: unknown) => void,
    ): this
    emit(event: typeof PeerEvent.Disconnected, code: number, reason: string): boolean
    emit(
        event: typeof PeerEvent.Chat,
        text: string | undefined,
        to?: string | string[],
        replyTo?: string,
        attachments?: MediaAttachment[],
    ): boolean
    emit(event: typeof PeerEvent.Typing): boolean
    emit(event: typeof PeerEvent.Edit, id: string, text: string): boolean
    emit(event: typeof PeerEvent.Delete, id: string): boolean
    emit(event: typeof PeerEvent.Reaction, msgId: string, emoji: string): boolean
    emit(event: typeof PeerEvent.Read, id: string): boolean
    emit(event: typeof PeerEvent.WhiteboardEvent, eventType: string, data: unknown): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter overload pattern
export class Peer extends EventEmitter {
    readonly id: string
    readonly role: PeerRole
    lastPong: number

    private readonly ws: WebSocket
    private readonly onSignal: (to: string, data: unknown) => void

    constructor(
        id: string,
        role: PeerRole,
        ws: WebSocket,
        onSignal: (to: string, data: unknown) => void,
    ) {
        super()
        this.id = id
        this.role = role
        this.ws = ws
        this.onSignal = onSignal
        this.lastPong = Date.now()

        this.ws.on('message', (raw) => this.handleMessage(raw.toString()))
        this.ws.on('close', (code, reason) => {
            this.emit(PeerEvent.Disconnected, code, reason.toString())
        })
    }

    send(msg: ServerMessage): void {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg))
        }
    }

    ping(): void {
        this.send({ type: MessageType.Ping })
    }

    disconnect(code: number, reason: string): void {
        this.ws.close(code, reason)
    }

    private handleMessage(raw: string): void {
        let parsed: unknown
        try {
            parsed = JSON.parse(raw)
        } catch {
            return
        }
        const result = ClientMessageSchema.safeParse(parsed)
        if (!result.success) return
        const msg = result.data
        switch (msg.type) {
            case MessageType.Signal:
                this.onSignal(msg.to, msg.data)
                break
            case MessageType.Pong:
                this.lastPong = Date.now()
                break
            case MessageType.Chat:
                this.emit(PeerEvent.Chat, msg.text, msg.to, msg.replyTo, msg.attachments)
                break
            case MessageType.Typing:
                this.emit(PeerEvent.Typing)
                break
            case MessageType.Edit:
                this.emit(PeerEvent.Edit, msg.id, msg.text)
                break
            case MessageType.Delete:
                this.emit(PeerEvent.Delete, msg.id)
                break
            case MessageType.Reaction:
                this.emit(PeerEvent.Reaction, msg.msgId, msg.emoji)
                break
            case MessageType.Read:
                this.emit(PeerEvent.Read, msg.id)
                break
            case MessageType.WhiteboardEvent:
                this.emit(PeerEvent.WhiteboardEvent, msg.eventType, msg.data)
                break
        }
    }
}
