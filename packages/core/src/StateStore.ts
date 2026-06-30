import { type Clock, systemClock } from './Clock.js'

export interface StateStore {
    get<T>(key: string): Promise<T | undefined>
    set<T>(key: string, value: T, ttlMs?: number): Promise<void>
    delete(key: string): Promise<void>
    has(key: string): Promise<boolean>
    keys(prefix?: string): Promise<string[]>
}

interface Entry {
    value: unknown
    expiresAt?: number
}

export class MemoryStateStore implements StateStore {
    private readonly _map = new Map<string, Entry>()

    constructor(private readonly _clock: Clock = systemClock) {}

    private _live(key: string): Entry | undefined {
        const e = this._map.get(key)
        if (!e) return undefined
        if (e.expiresAt !== undefined && e.expiresAt <= this._clock.now()) {
            this._map.delete(key)
            return undefined
        }
        return e
    }

    async get<T>(key: string): Promise<T | undefined> {
        return this._live(key)?.value as T | undefined
    }

    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
        this._map.set(key, {
            value,
            expiresAt: ttlMs !== undefined ? this._clock.now() + ttlMs : undefined,
        })
    }

    async delete(key: string): Promise<void> {
        this._map.delete(key)
    }

    async has(key: string): Promise<boolean> {
        return this._live(key) !== undefined
    }

    async keys(prefix?: string): Promise<string[]> {
        const out: string[] = []
        for (const key of this._map.keys()) {
            if (prefix !== undefined && !key.startsWith(prefix)) continue
            if (this._live(key)) out.push(key)
        }
        return out
    }
}
