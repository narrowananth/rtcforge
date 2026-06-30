import { describe, expect, it, vi } from 'vitest'
import { ManualClock, systemClock } from '../src/Clock.js'
import { SequentialId, randomId } from '../src/IdGenerator.js'
import { MemoryLock, noopLock } from '../src/Lock.js'
import { MemoryMembership } from '../src/Membership.js'
import { MembershipReconciler } from '../src/MembershipReconciler.js'
import { LocalMessageBus } from '../src/MessageBus.js'
import { MemoryStateStore } from '../src/StateStore.js'

describe('Clock', () => {
    it('systemClock.now returns a real timestamp', () => {
        expect(systemClock.now()).toBeGreaterThan(0)
    })

    it('ManualClock advances only on advance()', () => {
        const clock = new ManualClock(1000)
        expect(clock.now()).toBe(1000)
        clock.advance(500)
        expect(clock.now()).toBe(1500)
    })

    it('ManualClock fires due timers in order', () => {
        const clock = new ManualClock()
        const calls: string[] = []
        clock.setTimeout(() => calls.push('b'), 200)
        clock.setTimeout(() => calls.push('a'), 100)
        clock.advance(250)
        expect(calls).toEqual(['a', 'b'])
    })

    it('ManualClock does not fire cleared timers', () => {
        const clock = new ManualClock()
        const fn = vi.fn()
        const h = clock.setTimeout(fn, 100)
        clock.clearTimeout(h)
        clock.advance(200)
        expect(fn).not.toHaveBeenCalled()
    })
})

describe('IdGenerator', () => {
    it('randomId produces unique values', () => {
        const a = randomId.next()
        const b = randomId.next()
        expect(a).not.toBe(b)
    })

    it('SequentialId is deterministic with prefix', () => {
        const gen = new SequentialId('peer-')
        expect(gen.next()).toBe('peer-1')
        expect(gen.next()).toBe('peer-2')
    })
})

describe('MemoryStateStore', () => {
    it('set/get round-trips a value', async () => {
        const store = new MemoryStateStore()
        await store.set('room:r1', { peers: 3 })
        expect(await store.get('room:r1')).toEqual({ peers: 3 })
    })

    it('get returns undefined for missing key', async () => {
        const store = new MemoryStateStore()
        expect(await store.get('nope')).toBeUndefined()
    })

    it('delete removes a key', async () => {
        const store = new MemoryStateStore()
        await store.set('k', 1)
        await store.delete('k')
        expect(await store.has('k')).toBe(false)
    })

    it('keys filters by prefix and excludes expired', async () => {
        const clock = new ManualClock()
        const store = new MemoryStateStore(clock)
        await store.set('room:a', 1)
        await store.set('room:b', 2, 100)
        await store.set('peer:c', 3)
        expect((await store.keys('room:')).sort()).toEqual(['room:a', 'room:b'])
        clock.advance(150)
        expect(await store.keys('room:')).toEqual(['room:a'])
    })

    it('TTL expires entries lazily on access', async () => {
        const clock = new ManualClock()
        const store = new MemoryStateStore(clock)
        await store.set('k', 'v', 100)
        expect(await store.get('k')).toBe('v')
        clock.advance(101)
        expect(await store.get('k')).toBeUndefined()
    })
})

describe('LocalMessageBus', () => {
    it('delivers published messages to subscribers of the topic', async () => {
        const bus = new LocalMessageBus()
        const handler = vi.fn()
        bus.subscribe('room:r1', handler)
        await bus.publish('room:r1', { hello: 1 })
        expect(handler).toHaveBeenCalledWith({ hello: 1 })
    })

    it('does not deliver across topics', async () => {
        const bus = new LocalMessageBus()
        const handler = vi.fn()
        bus.subscribe('room:r1', handler)
        await bus.publish('room:r2', {})
        expect(handler).not.toHaveBeenCalled()
    })

    it('unsubscribe stops delivery', async () => {
        const bus = new LocalMessageBus()
        const handler = vi.fn()
        const off = bus.subscribe('t', handler)
        off()
        await bus.publish('t', {})
        expect(handler).not.toHaveBeenCalled()
    })
})

describe('Lock', () => {
    it('noopLock always acquires', async () => {
        expect(await noopLock.acquire('k', 1000)).not.toBeNull()
        expect(await noopLock.acquire('k', 1000)).not.toBeNull()
    })

    it('MemoryLock grants exclusive ownership', async () => {
        const lock = new MemoryLock()
        expect(await lock.acquire('room:r1', 1000)).not.toBeNull()
        expect(await lock.acquire('room:r1', 1000)).toBeNull()
    })

    it('MemoryLock releases ownership', async () => {
        const lock = new MemoryLock()
        const token = await lock.acquire('k', 1000)
        expect(token).not.toBeNull()
        await lock.release('k', token as string)
        expect(await lock.acquire('k', 1000)).not.toBeNull()
    })

    it('MemoryLock expires a stale holder after TTL', async () => {
        const clock = new ManualClock()
        const lock = new MemoryLock(clock)
        await lock.acquire('k', 100)
        expect(await lock.acquire('k', 100)).toBeNull()
        clock.advance(101)
        expect(await lock.acquire('k', 100)).not.toBeNull()
    })

    it('MemoryLock release with a stale token does not free the new holder', async () => {
        const clock = new ManualClock()
        const lock = new MemoryLock(clock)
        const tokenA = await lock.acquire('k', 100)
        clock.advance(101)
        const tokenB = await lock.acquire('k', 100)
        expect(tokenB).not.toBeNull()
        await lock.release('k', tokenA as string)
        expect(await lock.acquire('k', 100)).toBeNull()
        await lock.release('k', tokenB as string)
        expect(await lock.acquire('k', 100)).not.toBeNull()
    })
})

describe('MemoryMembership', () => {
    it('register then list returns the node', async () => {
        const m = new MemoryMembership()
        await m.register({ id: 'n1', region: 'us-east' }, 1000)
        const nodes = await m.list()
        expect(nodes).toEqual([{ id: 'n1', region: 'us-east' }])
    })

    it('watch fires on register and deregister', async () => {
        const m = new MemoryMembership()
        const watcher = vi.fn()
        m.watch(watcher)
        await m.register({ id: 'n1' }, 1000)
        await m.deregister('n1')
        expect(watcher).toHaveBeenCalledTimes(2)
        expect(watcher).toHaveBeenLastCalledWith([])
    })

    it('drops a node whose TTL expired (failover detection)', async () => {
        const clock = new ManualClock()
        const m = new MemoryMembership(clock)
        await m.register({ id: 'n1' }, 100)
        clock.advance(150)
        expect(await m.list()).toEqual([])
    })

    it('renew extends a node lease', async () => {
        const clock = new ManualClock()
        const m = new MemoryMembership(clock)
        await m.register({ id: 'n1' }, 100)
        clock.advance(80)
        await m.register({ id: 'n1' }, 100)
        clock.advance(80)
        expect(await m.list()).toEqual([{ id: 'n1' }])
    })
})

describe('MembershipReconciler', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0))

    it('emits onAdd for new ids and onRemove for departed ids', async () => {
        const m = new MemoryMembership()
        const added: string[] = []
        const removed: string[] = []
        const r = new MembershipReconciler(m, {
            onAdd: (n) => added.push(n.id),
            onRemove: (id) => removed.push(id),
        })
        r.start()
        await m.register({ id: 'n1' }, 1000)
        await m.register({ id: 'n2' }, 1000)
        await m.deregister('n1')
        expect(added).toEqual(['n1', 'n2'])
        expect(removed).toEqual(['n1'])
    })

    it('emits onUpdate (not onAdd) for an already-tracked id', async () => {
        const m = new MemoryMembership()
        const added: string[] = []
        const updated: string[] = []
        const r = new MembershipReconciler(m, {
            onAdd: (n) => added.push(n.id),
            onRemove: () => {},
            onUpdate: (n) => updated.push(n.id),
        })
        r.start()
        await m.register({ id: 'n1' }, 1000)
        await m.register({ id: 'n1', region: 'eu' }, 1000)
        expect(added).toEqual(['n1'])
        expect(updated).toEqual(['n1'])
    })

    it('seeds from list() only when no watch notification arrived first', async () => {
        const m = new MemoryMembership()
        await m.register({ id: 'pre' }, 1000)
        const added: string[] = []
        const r = new MembershipReconciler(m, {
            onAdd: (n) => added.push(n.id),
            onRemove: () => {},
        })
        r.start()
        await flush()
        expect(added).toEqual(['pre'])
    })

    it('dispose stops further callbacks', async () => {
        const m = new MemoryMembership()
        const added: string[] = []
        const r = new MembershipReconciler(m, {
            onAdd: (n) => added.push(n.id),
            onRemove: () => {},
        })
        r.start()
        r.dispose()
        await m.register({ id: 'n1' }, 1000)
        expect(added).toEqual([])
    })
})
