/**
 * Sliding-window rate limiter tracking event timestamps.
 *
 * @remarks
 * Retains the timestamps of recent {@link RateLimiter.allow | allow} calls within
 * a rolling `windowMs` window and rejects once `maxPerWindow` is reached. Expired
 * timestamps are evicted on each call, so memory stays bounded by the limit. One
 * instance tracks one subject (e.g. a peer or connection); create separate
 * limiters per subject.
 */
export class RateLimiter {
    private readonly _hits: number[] = []

    /**
     * @param maxPerWindow - Maximum number of allowed events within the window.
     * @param windowMs - Rolling window length in milliseconds.
     */
    constructor(
        private readonly maxPerWindow: number,
        private readonly windowMs = 1000,
    ) {}

    allow(now: number = Date.now()): boolean {
        const cutoff = now - this.windowMs
        let expired = 0
        while (expired < this._hits.length && this._hits[expired] <= cutoff) expired++
        if (expired > 0) this._hits.splice(0, expired)

        if (this._hits.length >= this.maxPerWindow) return false
        this._hits.push(now)
        return true
    }
}
