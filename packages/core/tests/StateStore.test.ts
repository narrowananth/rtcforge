import { describe, expect, it } from 'vitest'
import { ManualClock } from '../src/Clock.js'
import { MemoryStateStore } from '../src/StateStore.js'

describe('MemoryStateStore', () => {
    it('stores and reads values', async () => {
        const store = new MemoryStateStore(new ManualClock())
        await store.set('a', 1)
        expect(await store.get<number>('a')).toBe(1)
        expect(await store.has('a')).toBe(true)
        expect(await store.keys()).toEqual(['a'])
    })

    it('lazily expires values on access', async () => {
        const clock = new ManualClock()
        const store = new MemoryStateStore(clock)
        await store.set('a', 1, 1000)
        clock.advance(1001)
        expect(await store.get('a')).toBeUndefined()
        expect(await store.has('a')).toBe(false)
    })

    it('keys respects a prefix filter', async () => {
        const store = new MemoryStateStore(new ManualClock())
        await store.set('room:1', 1)
        await store.set('room:2', 2)
        await store.set('other', 3)
        expect((await store.keys('room:')).sort()).toEqual(['room:1', 'room:2'])
    })

    it('background sweeper proactively purges expired keys', async () => {
        const clock = new ManualClock()
        // Sweep interval uses wall-clock (setInterval); TTL expiry uses the
        // injected ManualClock. Keep the interval tiny so the test is quick.
        const store = new MemoryStateStore(clock, 10)
        try {
            await store.set('a', 1, 1000)
            const internal = store as unknown as { _map: Map<string, unknown> }

            clock.advance(1001) // key is now expired but not yet accessed
            expect(internal._map.has('a')).toBe(true) // still resident (no access yet)

            // Wait for the wall-clock sweeper to fire a few times.
            await new Promise((r) => setTimeout(r, 60))
            expect(internal._map.has('a')).toBe(false) // swept without any read
        } finally {
            store.stop()
        }
    })

    it('stop() is idempotent and safe when no sweeper was started', () => {
        const store = new MemoryStateStore(new ManualClock())
        expect(() => {
            store.stop()
            store.stop()
        }).not.toThrow()
    })
})
