import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Peer, Room } from '@rtcforge/signaling'
import { MessageType, PeerEvent, RoomEvent } from '@rtcforge/signaling'
import type { MediaAttachment, ServerMessage } from '@rtcforge/signaling'
import { InMemoryMessageStore } from './MessageStore.js'
import { ChatServiceEvent, noopLogger } from './types.js'
import type { ChatMessage, ChatServiceOptions, Logger, MessageStore } from './types.js'

export declare interface ChatService {
    on(event: typeof ChatServiceEvent.Message, listener: (msg: ChatMessage) => void): this
    on(event: typeof ChatServiceEvent.Typing, listener: (peerId: string) => void): this
    on(event: typeof ChatServiceEvent.Error, listener: (err: Error) => void): this
    on(event: typeof ChatServiceEvent.Delivered, listener: (id: string) => void): this
    on(event: typeof ChatServiceEvent.Read, listener: (id: string, by: string) => void): this
    on(
        event: typeof ChatServiceEvent.Edited,
        listener: (id: string, text: string, editedAt: number, by: string) => void,
    ): this
    on(event: typeof ChatServiceEvent.Deleted, listener: (id: string, by: string) => void): this
    on(
        event: typeof ChatServiceEvent.Reaction,
        listener: (msgId: string, emoji: string, by: string) => void,
    ): this
    once(event: typeof ChatServiceEvent.Message, listener: (msg: ChatMessage) => void): this
    once(event: typeof ChatServiceEvent.Typing, listener: (peerId: string) => void): this
    once(event: typeof ChatServiceEvent.Error, listener: (err: Error) => void): this
    once(event: typeof ChatServiceEvent.Delivered, listener: (id: string) => void): this
    once(event: typeof ChatServiceEvent.Read, listener: (id: string, by: string) => void): this
    once(
        event: typeof ChatServiceEvent.Edited,
        listener: (id: string, text: string, editedAt: number, by: string) => void,
    ): this
    once(event: typeof ChatServiceEvent.Deleted, listener: (id: string, by: string) => void): this
    once(
        event: typeof ChatServiceEvent.Reaction,
        listener: (msgId: string, emoji: string, by: string) => void,
    ): this
    emit(event: typeof ChatServiceEvent.Message, msg: ChatMessage): boolean
    emit(event: typeof ChatServiceEvent.Typing, peerId: string): boolean
    emit(event: typeof ChatServiceEvent.Error, err: Error): boolean
    emit(event: typeof ChatServiceEvent.Delivered, id: string): boolean
    emit(event: typeof ChatServiceEvent.Read, id: string, by: string): boolean
    emit(
        event: typeof ChatServiceEvent.Edited,
        id: string,
        text: string,
        editedAt: number,
        by: string,
    ): boolean
    emit(event: typeof ChatServiceEvent.Deleted, id: string, by: string): boolean
    emit(event: typeof ChatServiceEvent.Reaction, msgId: string, emoji: string, by: string): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter overload pattern
export class ChatService extends EventEmitter {
    private readonly room: Room
    private readonly logger: Logger
    private readonly typingDebounceMs: number
    private readonly store: MessageStore
    private readonly sendRoles: Set<string> | null
    private readonly onOfflineMessage?: (peerId: string, msg: ChatMessage) => void
    private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly wiredPeers = new Set<string>()

    constructor(room: Room, opts: ChatServiceOptions = {}) {
        super()
        this.room = room
        this.logger = opts.logger ?? noopLogger
        this.typingDebounceMs = opts.typingDebounceMs ?? 3000
        this.store = opts.store ?? new InMemoryMessageStore()
        this.sendRoles = opts.sendRoles ? new Set(opts.sendRoles) : null
        this.onOfflineMessage = opts.onOfflineMessage

        for (const peer of room.getPeers()) {
            this.wirePeer(peer)
        }

        room.on(RoomEvent.PeerJoined, (peer) => this.wirePeer(peer))
        room.on(RoomEvent.PeerLeft, (peer) => this.cleanupPeer(peer.id))
    }

    send(msg: {
        from: string
        text?: string
        to?: string | string[]
        replyTo?: string
        attachments?: MediaAttachment[]
    }): void {
        this.broadcastChat(null, msg.from, msg.text, msg.to, msg.replyTo, msg.attachments)
    }

    private isVisibleTo(msg: ChatMessage, peerId: string): boolean {
        if (!msg.to) return true
        if (msg.from === peerId) return true
        if (typeof msg.to === 'string') return msg.to === peerId
        return msg.to.includes(peerId)
    }

    private wirePeer(peer: Peer): void {
        if (this.wiredPeers.has(peer.id)) return
        this.wiredPeers.add(peer.id)

        const history = this.store.getHistory().filter((m) => this.isVisibleTo(m, peer.id))
        if (history.length > 0) {
            peer.send({ type: MessageType.History, messages: history })
        }

        peer.on(PeerEvent.Typing, () => {
            if (this.typingTimers.has(peer.id)) return

            this.room.broadcastExcept(peer.id, {
                type: MessageType.Typing,
                peerId: peer.id,
            })
            this.emit(ChatServiceEvent.Typing, peer.id)
            this.logger.debug('Typing indicator broadcast', { peerId: peer.id })

            const timer = setTimeout(() => {
                this.typingTimers.delete(peer.id)
            }, this.typingDebounceMs)
            this.typingTimers.set(peer.id, timer)
        })

        if (this.sendRoles !== null && !this.sendRoles.has(peer.role)) return

        peer.on(PeerEvent.Chat, (text, to, replyTo, attachments) =>
            this.broadcastChat(peer, peer.id, text, to, replyTo, attachments),
        )

        peer.on(PeerEvent.Edit, (id, text) => this.handleEdit(peer, id, text))
        peer.on(PeerEvent.Delete, (id) => this.handleDelete(peer, id))
        peer.on(PeerEvent.Reaction, (msgId, emoji) => this.handleReaction(peer, msgId, emoji))
        peer.on(PeerEvent.Read, (id) => this.handleRead(peer, id))
    }

    private broadcastChat(
        fromPeer: Peer | null,
        from: string,
        text: string | undefined,
        to?: string | string[],
        replyTo?: string,
        attachments?: MediaAttachment[],
    ): void {
        if (!text && !attachments?.length) {
            this.emit(
                ChatServiceEvent.Error,
                new Error('Message must have text or at least one attachment'),
            )
            return
        }

        const chatMsg: ChatMessage = {
            id: randomUUID(),
            seq: this.store.nextSeq(),
            from,
            ts: Date.now(),
            ...(text !== undefined && { text }),
            ...(to !== undefined && { to }),
            ...(replyTo !== undefined && { replyTo }),
            ...(attachments?.length && { attachments }),
        }

        try {
            this.store.append(chatMsg)

            const serverMsg: ServerMessage = {
                type: MessageType.Chat,
                id: chatMsg.id,
                seq: chatMsg.seq,
                from: chatMsg.from,
                text: chatMsg.text,
                ts: chatMsg.ts,
                to: chatMsg.to,
                replyTo: chatMsg.replyTo,
                attachments: chatMsg.attachments,
            }

            if (to === undefined) {
                this.room.broadcast(serverMsg)
            } else if (typeof to === 'string') {
                const targetPeer = this.room.getPeer(to)
                if (targetPeer) {
                    targetPeer.send(serverMsg)
                } else {
                    this.onOfflineMessage?.(to, chatMsg)
                }
                fromPeer?.send(serverMsg)
            } else {
                const sentToPeerIds = new Set<string>()
                for (const peerId of to) {
                    if (sentToPeerIds.has(peerId)) continue
                    sentToPeerIds.add(peerId)
                    const targetPeer = this.room.getPeer(peerId)
                    if (targetPeer) {
                        targetPeer.send(serverMsg)
                    } else {
                        this.onOfflineMessage?.(peerId, chatMsg)
                    }
                }
                if (fromPeer && !sentToPeerIds.has(fromPeer.id)) {
                    fromPeer.send(serverMsg)
                }
            }

            if (fromPeer) {
                fromPeer.send({ type: MessageType.Delivered, id: chatMsg.id })
            }

            this.emit(ChatServiceEvent.Message, chatMsg)
            this.emit(ChatServiceEvent.Delivered, chatMsg.id)
            this.logger.debug('Chat message sent', {
                from,
                mode: to === undefined ? 'broadcast' : typeof to === 'string' ? 'dm' : 'group',
            })
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            this.logger.error('Failed to send chat message', { err: error.message })
            this.emit(ChatServiceEvent.Error, error)
        }
    }

    private handleEdit(peer: Peer, id: string, text: string): void {
        const msg = this.store.getById(id)
        if (!msg || msg.from !== peer.id) return
        const editedAt = Date.now()
        if (!this.store.update(id, { text, editedAt })) return
        this.room.broadcast({ type: MessageType.Edited, id, text, editedAt, by: peer.id })
        this.emit(ChatServiceEvent.Edited, id, text, editedAt, peer.id)
        this.logger.debug('Message edited', { id, by: peer.id })
    }

    private handleDelete(peer: Peer, id: string): void {
        const msg = this.store.getById(id)
        if (!msg || msg.from !== peer.id) return
        if (!this.store.delete(id)) return
        this.room.broadcast({ type: MessageType.Deleted, id, by: peer.id })
        this.emit(ChatServiceEvent.Deleted, id, peer.id)
        this.logger.debug('Message deleted', { id, by: peer.id })
    }

    private handleReaction(peer: Peer, msgId: string, emoji: string): void {
        if (!this.store.getById(msgId)) return
        this.room.broadcast({ type: MessageType.Reaction, msgId, emoji, by: peer.id })
        this.emit(ChatServiceEvent.Reaction, msgId, emoji, peer.id)
    }

    private handleRead(peer: Peer, id: string): void {
        const msg = this.store.getById(id)
        if (!msg) return
        const sender = this.room.getPeer(msg.from)
        sender?.send({ type: MessageType.Read, id, by: peer.id })
        this.emit(ChatServiceEvent.Read, id, peer.id)
    }

    private cleanupPeer(peerId: string): void {
        this.wiredPeers.delete(peerId)
        const timer = this.typingTimers.get(peerId)
        if (timer !== undefined) {
            clearTimeout(timer)
            this.typingTimers.delete(peerId)
        }
    }
}
