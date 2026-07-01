/**
 * Abstraction over time and timers.
 *
 * Components that need the current time or need to schedule work take a `Clock` rather than
 * calling `Date.now` / `setTimeout` directly. In production pass {@link systemClock}; in tests
 * pass a {@link ManualClock} to advance time deterministically.
 */
export interface Clock {
    /**
     * Returns the current time.
     * @returns Milliseconds since an implementation-defined epoch (the Unix epoch for {@link systemClock}).
     */
    now(): number
    /**
     * Schedules `fn` to run after approximately `ms` milliseconds.
     * @param fn - The callback to invoke when the delay elapses.
     * @param ms - Delay in milliseconds.
     * @returns An opaque handle that can be passed to {@link Clock.clearTimeout | clearTimeout}.
     */
    setTimeout(fn: () => void, ms: number): unknown
    /**
     * Cancels a timer previously created with {@link Clock.setTimeout | setTimeout}.
     * @param handle - The handle returned by `setTimeout`.
     */
    clearTimeout(handle: unknown): void
}

/**
 * The default {@link Clock} backed by the host's real time and timer APIs
 * (`Date.now`, `setTimeout`, `clearTimeout`).
 */
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

/**
 * A {@link Clock} whose time only moves when you call {@link ManualClock.advance | advance},
 * for deterministic testing of time-dependent code.
 *
 * @remarks
 * Scheduled callbacks fire during `advance` in due-time order, mirroring real timer semantics
 * without any wall-clock waiting.
 *
 * @example
 * ```ts
 * const clock = new ManualClock()
 * let fired = false
 * clock.setTimeout(() => { fired = true }, 1000)
 * clock.advance(999) // fired === false
 * clock.advance(1)   // fired === true
 * ```
 */
export class ManualClock implements Clock {
    private _now: number
    private _nextId = 1
    private _tasks: ScheduledTask[] = []

    /**
     * @param startMs - The initial value returned by {@link ManualClock.now | now}.
     * @defaultValue `0`
     */
    constructor(startMs = 0) {
        this._now = startMs
    }

    /**
     * Returns the current simulated time.
     * @returns The current time in milliseconds; changes only via {@link ManualClock.advance | advance}.
     */
    now(): number {
        return this._now
    }

    /**
     * Schedules `fn` to fire once simulated time reaches `now() + ms`.
     * @param fn - The callback to invoke when due.
     * @param ms - Delay in milliseconds; negative values are clamped to `0`.
     * @returns A numeric handle for {@link ManualClock.clearTimeout | clearTimeout}.
     */
    setTimeout(fn: () => void, ms: number): unknown {
        const id = this._nextId++
        this._tasks.push({ id, fireAt: this._now + Math.max(0, ms), fn })
        return id
    }

    /**
     * Cancels a scheduled callback.
     * @param handle - The handle returned by {@link ManualClock.setTimeout | setTimeout}.
     */
    clearTimeout(handle: unknown): void {
        this._tasks = this._tasks.filter((t) => t.id !== handle)
    }

    /**
     * Advances simulated time by `ms`, firing every callback whose due time falls within the
     * new interval, in ascending due-time order.
     *
     * @param ms - The number of milliseconds to advance.
     * @remarks Each callback runs at exactly its scheduled time; callbacks scheduled by other callbacks during advancement are honored if they become due within the same interval. After all due callbacks run, {@link ManualClock.now | now} equals the target time.
     */
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
