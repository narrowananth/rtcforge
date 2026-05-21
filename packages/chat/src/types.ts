import type { Logger, MetricsCollector } from '@rtcforge/core'
import type { MediaAttachment, PeerRole } from '@rtcforge/signaling'
export type { Logger, MetricsCollector, MediaAttachment, PeerRole }
export { noopLogger } from '@rtcforge/core'

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

export interface MessageStore {
    nextSeq(): number
    append(msg: ChatMessage): void
    getHistory(limit?: number): ChatMessage[]
    getById(id: string): ChatMessage | undefined
    update(id: string, patch: { text: string; editedAt: number }): boolean
    delete(id: string): boolean
}

export const ChatServiceEvent = {
    Message: 'message',
    Typing: 'typing',
    Error: 'error',
    Delivered: 'delivered',
    Read: 'read',
    Edited: 'edited',
    Deleted: 'deleted',
    Reaction: 'reaction',
} as const

export type ChatServiceEvent = (typeof ChatServiceEvent)[keyof typeof ChatServiceEvent]

export const PresenceEvent = {
    Online: 'online',
    Offline: 'offline',
} as const

export type PresenceEvent = (typeof PresenceEvent)[keyof typeof PresenceEvent]

export interface ChatServiceOptions {
    logger?: Logger
    metrics?: MetricsCollector
    typingDebounceMs?: number
    store?: MessageStore
    sendRoles?: PeerRole[]
    onOfflineMessage?: (peerId: string, msg: ChatMessage) => void
}

export interface PresenceServiceOptions {
    logger?: Logger
    metrics?: MetricsCollector
    onLastSeen?: (peerId: string, ts: number) => void
}
