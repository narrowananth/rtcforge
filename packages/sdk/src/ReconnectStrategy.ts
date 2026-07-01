/**
 * Policy governing when and how far apart a {@link Transport} retries after a
 * dropped connection. Supply a custom implementation via
 * {@link TransportOptions.reconnectStrategy} to change the backoff curve or
 * retry limit.
 */
export interface BackoffStrategy {
    /** Number of delays handed out since the last {@link BackoffStrategy.reset}. */
    readonly attempt: number
    /** Resets the attempt counter, typically called once a connection succeeds. */
    reset(): void
    /** Returns `true` when the retry limit has been reached and no further attempts should be made. */
    isExhausted(): boolean
    /** Returns the delay (ms) before the next attempt and advances the attempt counter. */
    nextDelay(): number
}

/**
 * Default {@link BackoffStrategy}: exponential backoff (`1000 * 2^attempt`,
 * capped at `maxDelayMs`) with up to 30% added jitter to avoid synchronized
 * reconnect storms. Optionally bounded by a maximum attempt count.
 */
export class ReconnectStrategy implements BackoffStrategy {
    private _attempt = 0

    /**
     * @param maxDelayMs - Ceiling (ms) for the exponential delay before jitter is applied.
     * @param maxAttempts - Maximum number of attempts before {@link ReconnectStrategy.isExhausted} reports `true`; unlimited when omitted.
     */
    constructor(
        private readonly maxDelayMs: number,
        private readonly maxAttempts?: number,
    ) {}

    /** Number of delays handed out since the last {@link ReconnectStrategy.reset}. */
    get attempt(): number {
        return this._attempt
    }

    /** Resets the attempt counter to zero. Called on a successful connect. */
    reset(): void {
        this._attempt = 0
    }

    /** Returns `true` once the configured `maxAttempts` has been reached (never, if unbounded). */
    isExhausted(): boolean {
        return this.maxAttempts !== undefined && this._attempt >= this.maxAttempts
    }

    /**
     * Computes the delay before the next reconnect and increments the attempt
     * counter.
     * @returns Delay in milliseconds: `min(1000 * 2^attempt, maxDelayMs)` plus up to 30% random jitter.
     */
    nextDelay(): number {
        const base = Math.min(1000 * 2 ** this._attempt, this.maxDelayMs)
        const delay = base + base * 0.3 * Math.random()
        this._attempt++
        return delay
    }
}
