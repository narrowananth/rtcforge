import { describe, expect, it } from 'vitest'
import { ManualClock } from '../src/Clock.js'
import { MemoryLock } from '../src/Lock.js'

describe('MemoryLock', () => {
    it('grants the lock and blocks a second acquirer until release', async () => {
        const clock = new ManualClock()
        const lock = new MemoryLock(clock)
        const token = await lock.acquire('k', 1000)
        expect(token).not.toBeNull()
        expect(await lock.acquire('k', 1000)).toBeNull()
        await lock.release('k', token as string)
        expect(await lock.acquire('k', 1000)).not.toBeNull()
    })

    it('release with a wrong token is a no-op', async () => {
        const lock = new MemoryLock(new ManualClock())
        const token = await lock.acquire('k', 1000)
        await lock.release('k', 'not-the-token')
        expect(await lock.acquire('k', 1000)).toBeNull() // still held
        await lock.release('k', token as string)
    })

    it('expires after the TTL', async () => {
        const clock = new ManualClock()
        const lock = new MemoryLock(clock)
        await lock.acquire('k', 1000)
        expect(await lock.acquire('k', 1000)).toBeNull()
        clock.advance(1001)
        expect(await lock.acquire('k', 1000)).not.toBeNull()
    })

    it('issues unguessable, unique tokens (not sequential/key-derived)', async () => {
        const lock = new MemoryLock(new ManualClock())
        const tokens = new Set<string>()
        for (let i = 0; i < 100; i++) {
            const t = (await lock.acquire('room:1', 1000)) as string
            expect(t).not.toBeNull()
            // Not derived from the key or a predictable counter.
            expect(t).not.toBe('room:1:1')
            expect(t.startsWith('room:1:')).toBe(false)
            tokens.add(t)
            await lock.release('room:1', t)
        }
        expect(tokens.size).toBe(100) // all distinct
    })
})
