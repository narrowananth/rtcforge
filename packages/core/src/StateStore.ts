import { type Clock, systemClock } from './Clock.js'

/**
 * Async key/value store with optional per-key time-to-live (TTL).
 *
 * @remarks
 * This is the seam RTCForge uses for shared state (room state, session data, and so on).
 * The default in-process implementation is {@link MemoryStateStore}; production deployments
 * can supply an adapter backed by Redis or another store. Values are stored as-is and are
 * typed only by the caller-supplied type parameter — no runtime validation is performed.
 */
export interface StateStore {
    /**
     * Reads the value stored at `key`.
     * @typeParam T - Expected type of the stored value.
     * @param key - The key to read.
     * @returns The stored value, or `undefined` if the key is absent or expired.
     */
    get<T>(key: string): Promise<T | undefined>
    /**
     * Writes a value at `key`, optionally with a TTL after which it expires.
     * @typeParam T - Type of the value being stored.
     * @param key - The key to write.
     * @param value - The value to store.
     * @param ttlMs - Optional lifetime in milliseconds; if omitted the entry never expires.
     */
    set<T>(key: string, value: T, ttlMs?: number): Promise<void>
    /**
     * Removes the entry at `key`, if any.
     * @param key - The key to delete.
     */
    delete(key: string): Promise<void>
    /**
     * Reports whether a live (non-expired) entry exists at `key`.
     * @param key - The key to test.
     * @returns `true` if a non-expired value is present.
     */
    has(key: string): Promise<boolean>
    /**
     * Lists the keys of all live entries, optionally filtered by prefix.
     * @param prefix - When provided, only keys starting with this string are returned.
     * @returns The matching keys.
     */
    keys(prefix?: string): Promise<string[]>
}

interface Entry {
    value: unknown
    expiresAt?: number
}

/**
 * In-process {@link StateStore} backed by a `Map`, with lazy TTL expiration.
 *
 * @remarks
 * Suitable for single-process deployments and tests. Expired entries are evicted lazily on
 * access (`get`, `has`, `keys`) rather than by a background timer, using the injected
 * {@link Clock} to determine the current time. State is not shared across processes.
 * Optionally, a background sweeper (see the constructor's `sweepIntervalMs`) can proactively
 * purge expired keys so memory is reclaimed even for keys that are never read again.
 *
 * @example
 * ```ts
 * const store = new MemoryStateStore()
 * await store.set('room:1', { peers: 2 }, 60_000) // expires in 60s
 * await store.get<{ peers: number }>('room:1')     // { peers: 2 }
 * ```
 */
export class MemoryStateStore implements StateStore {
    private readonly _map = new Map<string, Entry>()
    private _sweepTimer: ReturnType<typeof setInterval> | null = null

    /**
     * @param _clock - Clock used to evaluate TTL expiration.
     * @defaultValue {@link systemClock}
     * @param sweepIntervalMs - When set (`> 0`), a background timer proactively purges
     *   expired entries every this-many milliseconds, reclaiming memory for keys that are
     *   never accessed again. Omit to disable (the default): expiry then stays purely lazy
     *   via {@link MemoryStateStore.get | get}/{@link MemoryStateStore.has | has}/{@link MemoryStateStore.keys | keys}.
     *   The timer is unref'd where supported so it never keeps a Node process alive.
     */
    constructor(
        private readonly _clock: Clock = systemClock,
        sweepIntervalMs?: number,
    ) {
        if (sweepIntervalMs !== undefined && sweepIntervalMs > 0) {
            this._sweepTimer = setInterval(() => this._purge(), sweepIntervalMs)
            if (typeof (this._sweepTimer as { unref?: () => void }).unref === 'function') {
                ;(this._sweepTimer as { unref: () => void }).unref()
            }
        }
    }

    /** Stops the background TTL sweeper (if one was started). Idempotent. */
    stop(): void {
        if (this._sweepTimer !== null) {
            clearInterval(this._sweepTimer)
            this._sweepTimer = null
        }
    }

    /** Removes every entry whose TTL has elapsed. Used by the background sweeper. */
    private _purge(): void {
        const now = this._clock.now()
        for (const [key, e] of this._map) {
            if (e.expiresAt !== undefined && e.expiresAt <= now) this._map.delete(key)
        }
    }

    private _live(key: string): Entry | undefined {
        const e = this._map.get(key)
        if (!e) return undefined
        if (e.expiresAt !== undefined && e.expiresAt <= this._clock.now()) {
            this._map.delete(key)
            return undefined
        }
        return e
    }

    /** {@inheritDoc StateStore.get} */
    async get<T>(key: string): Promise<T | undefined> {
        return this._live(key)?.value as T | undefined
    }

    /** {@inheritDoc StateStore.set} */
    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
        this._map.set(key, {
            value,
            expiresAt: ttlMs !== undefined ? this._clock.now() + ttlMs : undefined,
        })
    }

    /** {@inheritDoc StateStore.delete} */
    async delete(key: string): Promise<void> {
        this._map.delete(key)
    }

    /** {@inheritDoc StateStore.has} */
    async has(key: string): Promise<boolean> {
        return this._live(key) !== undefined
    }

    /** {@inheritDoc StateStore.keys} */
    async keys(prefix?: string): Promise<string[]> {
        const out: string[] = []
        for (const key of this._map.keys()) {
            if (prefix !== undefined && !key.startsWith(prefix)) continue
            if (this._live(key)) out.push(key)
        }
        return out
    }
}
