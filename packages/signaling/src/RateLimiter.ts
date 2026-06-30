export class RateLimiter {
    private readonly _hits: number[] = []

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
