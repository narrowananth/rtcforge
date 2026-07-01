/**
 * Buffer for messages produced while a {@link Transport} is offline, flushed in
 * FIFO order once the connection is (re)established. Implement this interface to
 * supply a custom buffering policy via {@link TransportOptions.sendQueue}.
 *
 * @typeParam T - The queued message type (typically {@link ClientMessage}).
 */
export interface MessageQueue<T> {
    /** Number of messages currently buffered. */
    readonly size: number
    /**
     * Appends a message to the queue.
     * @returns `true` if buffered, `false` if the queue was full and the message was dropped.
     */
    enqueue(item: T): boolean
    /** Sends and removes every buffered message in FIFO order via `send`. */
    drain(send: (item: T) => void): void
    /** Discards all buffered messages. */
    clear(): void
}

/**
 * Bounded FIFO {@link MessageQueue} used by {@link WebSocketTransport} to hold
 * outbound messages while the socket is closed or reconnecting. Once capacity
 * is reached, further {@link SendQueue.enqueue} calls are rejected rather than
 * evicting existing messages, so the transport can surface a "queue full" error.
 *
 * @typeParam T - The queued message type.
 */
export class SendQueue<T> implements MessageQueue<T> {
    private readonly _items: T[] = []

    /**
     * @param maxSize - Maximum number of messages the queue may hold before {@link SendQueue.enqueue} starts returning `false`.
     */
    constructor(private readonly maxSize: number) {}

    /** Number of messages currently buffered. */
    get size(): number {
        return this._items.length
    }

    /**
     * Appends a message unless the queue is at capacity.
     * @param item - The message to buffer.
     * @returns `true` if buffered, `false` if the queue was full.
     */
    enqueue(item: T): boolean {
        if (this._items.length >= this.maxSize) return false
        this._items.push(item)
        return true
    }

    /**
     * Flushes the queue in FIFO order, invoking `send` for each message and
     * removing it as it is sent.
     * @param send - Callback that transmits a single message.
     */
    drain(send: (item: T) => void): void {
        while (this._items.length > 0) {
            send(this._items[0])
            this._items.shift()
        }
    }

    /** Discards all buffered messages without sending them. */
    clear(): void {
        this._items.length = 0
    }
}
