export interface BackoffStrategy {
    readonly attempt: number
    reset(): void
    isExhausted(): boolean
    nextDelay(): number
}

export class ReconnectStrategy implements BackoffStrategy {
    private _attempt = 0

    constructor(
        private readonly maxDelayMs: number,
        private readonly maxAttempts?: number,
    ) {}

    get attempt(): number {
        return this._attempt
    }

    reset(): void {
        this._attempt = 0
    }

    isExhausted(): boolean {
        return this.maxAttempts !== undefined && this._attempt >= this.maxAttempts
    }

    nextDelay(): number {
        const base = Math.min(1000 * 2 ** this._attempt, this.maxDelayMs)
        const delay = base + base * 0.3 * Math.random()
        this._attempt++
        return delay
    }
}
