/**
 * Function returned by a subscription that, when called, cancels that subscription.
 */
export type Unsubscribe = () => void

/**
 * Publish/subscribe message bus keyed by topic.
 *
 * @remarks
 * This is the seam RTCForge uses to fan out messages (for example, broadcasting across nodes).
 * The default in-process implementation is {@link LocalMessageBus}; production deployments can
 * supply an adapter backed by Redis Pub/Sub, NATS, or similar. Messages are untyped (`unknown`)
 * and it is the caller's responsibility to serialize and validate payloads.
 */
export interface MessageBus {
    /**
     * Publishes `message` to all current subscribers of `topic`.
     * @param topic - The topic to publish on.
     * @param message - The payload to deliver to subscribers.
     */
    publish(topic: string, message: unknown): Promise<void>
    /**
     * Subscribes `handler` to `topic`.
     * @param topic - The topic to subscribe to.
     * @param handler - Callback invoked with each message published to the topic.
     * @returns An {@link Unsubscribe} function that removes this subscription when called.
     */
    subscribe(topic: string, handler: (message: unknown) => void): Unsubscribe
}

/**
 * In-process {@link MessageBus} that delivers messages synchronously to local subscribers.
 *
 * @remarks
 * Suitable for single-process deployments and tests; messages are not propagated across
 * processes or hosts. During {@link LocalMessageBus.publish | publish} the subscriber set is
 * snapshotted, so handlers may subscribe or unsubscribe without disturbing the current
 * delivery. Although the method is `async`, delivery to handlers happens synchronously before
 * the returned promise resolves.
 *
 * @example
 * ```ts
 * const bus = new LocalMessageBus()
 * const off = bus.subscribe('room:1', (msg) => console.log(msg))
 * await bus.publish('room:1', { type: 'joined', peer: 'p1' })
 * off() // stop receiving
 * ```
 */
export class LocalMessageBus implements MessageBus {
    private readonly _topics = new Map<string, Set<(message: unknown) => void>>()

    /** {@inheritDoc MessageBus.publish} */
    async publish(topic: string, message: unknown): Promise<void> {
        const handlers = this._topics.get(topic)
        if (!handlers) return
        for (const handler of [...handlers]) handler(message)
    }

    /** {@inheritDoc MessageBus.subscribe} */
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
