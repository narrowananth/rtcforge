import { type Clock, systemClock } from './Clock.js'

export interface Lock {
    acquire(key: string, ttlMs: number): Promise<string | null>
    release(key: string, token: string): Promise<void>
}

export const noopLock: Lock = {
    acquire: async () => 'noop',
    release: async () => {},
}

interface Holding {
    token: string
    expiresAt: number
}

export class MemoryLock implements Lock {
    private readonly _held = new Map<string, Holding>()
    private _seq = 0

    constructor(private readonly _clock: Clock = systemClock) {}

    async acquire(key: string, ttlMs: number): Promise<string | null> {
        const now = this._clock.now()
        const current = this._held.get(key)
        if (current !== undefined && current.expiresAt > now) return null
        const token = `${key}:${++this._seq}`
        this._held.set(key, { token, expiresAt: now + ttlMs })
        return token
    }

    async release(key: string, token: string): Promise<void> {
        const current = this._held.get(key)
        if (current !== undefined && current.token === token) {
            this._held.delete(key)
        }
    }
}
