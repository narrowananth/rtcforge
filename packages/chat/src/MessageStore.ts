import type { ChatMessage, MessageStore } from './types.js'

export class InMemoryMessageStore implements MessageStore {
    private readonly messages = new Map<string, ChatMessage>()
    private seq = 0

    nextSeq(): number {
        return ++this.seq
    }

    append(msg: ChatMessage): void {
        this.messages.set(msg.id, msg)
    }

    getHistory(limit?: number): ChatMessage[] {
        const all = Array.from(this.messages.values())
        return limit === undefined ? all : all.slice(-limit)
    }

    getById(id: string): ChatMessage | undefined {
        return this.messages.get(id)
    }

    update(id: string, patch: { text: string; editedAt: number }): boolean {
        const msg = this.messages.get(id)
        if (!msg) return false
        msg.text = patch.text
        msg.editedAt = patch.editedAt
        return true
    }

    delete(id: string): boolean {
        return this.messages.delete(id)
    }
}
