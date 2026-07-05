import { noopLogger } from 'rtcforge-core'
import type { Logger } from 'rtcforge-core'

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
     * @param logger - Optional logger; a failed `send` during {@link SendQueue.drain} is reported here instead of propagating.
     */
    constructor(
        private readonly maxSize: number,
        private readonly logger: Logger = noopLogger,
    ) {}

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
     * Flushes the queue in FIFO order, invoking `send` for each message. The
     * batch is spliced out up front (a single O(n) pass, no O(n²) shifting). If
     * `send` throws, draining stops and the failed message plus every
     * not-yet-sent message are re-queued ahead of any newly enqueued items so
     * FIFO order is preserved; the exception is logged rather than propagated.
     * @param send - Callback that transmits a single message.
     */
    drain(send: (item: T) => void): void {
        const batch = this._items.splice(0, this._items.length)
        for (let i = 0; i < batch.length; i++) {
            try {
                send(batch[i] as T)
            } catch (err) {
                // Re-queue the failed item and the rest, ahead of anything that
                // may have been enqueued re-entrantly during send.
                this._items.unshift(...batch.slice(i))
                this.logger.error('SendQueue drain failed; re-queued unsent messages', {
                    err: err instanceof Error ? err.message : String(err),
                    requeued: batch.length - i,
                })
                return
            }
        }
    }

    /** Discards all buffered messages without sending them. */
    clear(): void {
        this._items.length = 0
    }
}
