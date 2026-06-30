export interface Clock {
    now(): number
    setTimeout(fn: () => void, ms: number): unknown
    clearTimeout(handle: unknown): void
}

export const systemClock: Clock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

interface ScheduledTask {
    id: number
    fireAt: number
    fn: () => void
}

export class ManualClock implements Clock {
    private _now: number
    private _nextId = 1
    private _tasks: ScheduledTask[] = []

    constructor(startMs = 0) {
        this._now = startMs
    }

    now(): number {
        return this._now
    }

    setTimeout(fn: () => void, ms: number): unknown {
        const id = this._nextId++
        this._tasks.push({ id, fireAt: this._now + Math.max(0, ms), fn })
        return id
    }

    clearTimeout(handle: unknown): void {
        this._tasks = this._tasks.filter((t) => t.id !== handle)
    }

    advance(ms: number): void {
        const target = this._now + ms
        for (;;) {
            const due = this._tasks
                .filter((t) => t.fireAt <= target)
                .sort((a, b) => a.fireAt - b.fireAt)
            const next = due[0]
            if (!next) break
            this._tasks = this._tasks.filter((t) => t.id !== next.id)
            this._now = next.fireAt
            next.fn()
        }
        this._now = target
    }
}
