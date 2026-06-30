export type Unsubscribe = () => void

export interface MessageBus {
    publish(topic: string, message: unknown): Promise<void>
    subscribe(topic: string, handler: (message: unknown) => void): Unsubscribe
}

export class LocalMessageBus implements MessageBus {
    private readonly _topics = new Map<string, Set<(message: unknown) => void>>()

    async publish(topic: string, message: unknown): Promise<void> {
        const handlers = this._topics.get(topic)
        if (!handlers) return
        for (const handler of [...handlers]) handler(message)
    }

    subscribe(topic: string, handler: (message: unknown) => void): Unsubscribe {
        let set = this._topics.get(topic)
        if (!set) {
            set = new Set()
            this._topics.set(topic, set)
        }
        set.add(handler)
        return () => {
            const current = this._topics.get(topic)
            if (!current) return
            current.delete(handler)
            if (current.size === 0) this._topics.delete(topic)
        }
    }
}
