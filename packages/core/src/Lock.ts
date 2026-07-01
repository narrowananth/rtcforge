import { type Clock, systemClock } from './Clock.js'

/**
 * Distributed mutual-exclusion lock with fencing tokens and TTL-based expiry.
 *
 * @remarks
 * Locks are used to serialize work that must not run concurrently across nodes (for example,
 * ensuring a single owner processes a room). Each successful acquisition returns a unique token
 * that must be presented to {@link Lock.release | release}, preventing one holder from releasing
 * another's lock. Locks auto-expire after their TTL so a crashed holder cannot block others
 * forever. The default in-process implementation is {@link MemoryLock}; production deployments
 * can supply a Redis-backed adapter. Use {@link noopLock} to disable locking.
 */
export interface Lock {
    /**
     * Attempts to acquire the lock named `key`.
     * @param key - The lock name.
     * @param ttlMs - Lifetime of the lock in milliseconds; after this it expires and may be acquired by others.
     * @returns A unique fencing token to pass to {@link Lock.release | release} on success, or `null` if the lock is currently held.
     */
    acquire(key: string, ttlMs: number): Promise<string | null>
    /**
     * Releases a lock previously acquired with {@link Lock.acquire | acquire}.
     * @param key - The lock name.
     * @param token - The token returned by the matching `acquire` call.
     * @remarks A no-op if the lock is not held or the token does not match the current holder.
     */
    release(key: string, token: string): Promise<void>
}

/**
 * A {@link Lock} that never blocks: {@link Lock.acquire | acquire} always succeeds (returning
 * the token `'noop'`) and {@link Lock.release | release} does nothing.
 *
 * @remarks
 * Use to disable locking in single-node deployments or tests where mutual exclusion is unnecessary.
 */
export const noopLock: Lock = {
    acquire: async () => 'noop',
    release: async () => {},
}

interface Holding {
    token: string
    expiresAt: number
}

/**
 * In-process {@link Lock} backed by a `Map`, with TTL expiry evaluated via an injected {@link Clock}.
 *
 * @remarks
 * Provides real mutual exclusion within a single process. An expired lock is treated as free on
 * the next acquisition attempt. Not suitable for coordinating across processes or hosts.
 *
 * @example
 * ```ts
 * const lock = new MemoryLock()
 * const token = await lock.acquire('room:1', 5000)
 * if (token) {
 *   try {
 *     // ...critical section...
 *   } finally {
 *     await lock.release('room:1', token)
 *   }
 * }
 * ```
 */
export class MemoryLock implements Lock {
    private readonly _held = new Map<string, Holding>()
    private _seq = 0

    /**
     * @param _clock - Clock used to evaluate lock TTL expiry.
     * @defaultValue {@link systemClock}
     */
    constructor(private readonly _clock: Clock = systemClock) {}

    /** {@inheritDoc Lock.acquire} */
    async acquire(key: string, ttlMs: number): Promise<string | null> {
        const now = this._clock.now()
        const current = this._held.get(key)
        if (current !== undefined && current.expiresAt > now) return null
        const token = `${key}:${++this._seq}`
        this._held.set(key, { token, expiresAt: now + ttlMs })
        return token
    }

    /** {@inheritDoc Lock.release} */
    async release(key: string, token: string): Promise<void> {
        const current = this._held.get(key)
        if (current !== undefined && current.token === token) {
            this._held.delete(key)
        }
    }
}
