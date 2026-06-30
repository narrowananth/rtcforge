import { describe, expect, it } from 'vitest'
import { HashRing } from '../src/HashRing.js'

const nodes = (n: number) => Array.from({ length: n }, (_, i) => `node${i}`)
const keys = (n: number) => Array.from({ length: n }, (_, i) => `room:${i}`)

describe('HashRing — basics', () => {
    it('empty ring returns undefined', () => {
        expect(new HashRing().get('room:1')).toBeUndefined()
    })

    it('single node owns every key', () => {
        const ring = new HashRing(['n1'])
        expect(ring.get('room:1')).toBe('n1')
        expect(ring.get('room:9999')).toBe('n1')
    })

    it('get is deterministic across instances with the same node set', () => {
        const a = new HashRing(nodes(10))
        const b = new HashRing([...nodes(10)].reverse())
        for (const k of keys(200)) {
            expect(a.get(k)).toBe(b.get(k))
        }
    })

    it('owner is always a member of the ring', () => {
        const ids = new Set(nodes(8))
        const ring = new HashRing(nodes(8))
        for (const k of keys(500)) {
            expect(ids.has(ring.get(k) as string)).toBe(true)
        }
    })

    it('add/remove/has/size/nodeIds behave', () => {
        const ring = new HashRing()
        ring.add('a')
        ring.add({ id: 'b', weight: 2 })
        expect(ring.size).toBe(2)
        expect(ring.has('b')).toBe(true)
        expect(ring.remove('a')).toBe(true)
        expect(ring.remove('a')).toBe(false)
        expect(ring.nodeIds()).toEqual(['b'])
    })

    it('rejects non-positive weight', () => {
        expect(() => new HashRing([{ id: 'x', weight: 0 }])).toThrow()
    })
})

describe('HashRing — distribution', () => {
    it('spreads keys roughly evenly across equal-weight nodes', () => {
        const ring = new HashRing(nodes(10))
        const counts = new Map<string, number>()
        const total = 10_000
        for (const k of keys(total)) {
            const owner = ring.get(k) as string
            counts.set(owner, (counts.get(owner) ?? 0) + 1)
        }
        const expected = total / 10
        for (const c of counts.values()) {
            expect(c).toBeGreaterThan(expected * 0.75)
            expect(c).toBeLessThan(expected * 1.25)
        }
    })

    it('heavier node owns proportionally more keys', () => {
        const ring = new HashRing([{ id: 'big', weight: 4 }, 'small'])
        let big = 0
        const total = 10_000
        for (const k of keys(total)) if (ring.get(k) === 'big') big++
        const share = big / total

        expect(share).toBeGreaterThan(0.7)
        expect(share).toBeLessThan(0.9)
    })
})

describe('HashRing — minimal disruption (the property that makes sharding work)', () => {
    it("removing a node only remaps that node's keys", () => {
        const before = new HashRing(nodes(10))
        const after = new HashRing(nodes(10))
        after.remove('node3')

        let moved = 0
        let movedFromOthers = 0
        for (const k of keys(5000)) {
            const o1 = before.get(k) as string
            const o2 = after.get(k) as string
            if (o1 !== o2) {
                moved++
                if (o1 !== 'node3') movedFromOthers++
            }
        }

        expect(movedFromOthers).toBe(0)

        expect(moved).toBeGreaterThan(300)
        expect(moved).toBeLessThan(700)
    })

    it('adding a node only steals its fair share', () => {
        const before = new HashRing(nodes(10))
        const after = new HashRing(nodes(10))
        after.add('node10')

        let moved = 0
        let landedElsewhere = 0
        for (const k of keys(5000)) {
            const o1 = before.get(k) as string
            const o2 = after.get(k) as string
            if (o1 !== o2) {
                moved++
                if (o2 !== 'node10') landedElsewhere++
            }
        }

        expect(landedElsewhere).toBe(0)

        expect(moved).toBeGreaterThan(250)
        expect(moved).toBeLessThan(650)
    })
})

describe('HashRing — replicas (failover / cascade)', () => {
    it('getN returns owner first, then distinct ordered backups', () => {
        const ring = new HashRing(nodes(5))
        const top = ring.getN('room:42', 3)
        expect(top.length).toBe(3)
        expect(new Set(top).size).toBe(3)
        expect(top[0]).toBe(ring.get('room:42'))
    })

    it('getN caps at ring size', () => {
        const ring = new HashRing(nodes(3))
        expect(ring.getN('room:1', 10).length).toBe(3)
    })

    it('backup is stable when the owner is removed', () => {
        const ring = new HashRing(nodes(6))
        const [owner, backup] = ring.getN('room:7', 2)
        ring.remove(owner)
        expect(ring.get('room:7')).toBe(backup)
    })

    it('getN(_, 0) and empty ring return []', () => {
        expect(new HashRing(nodes(3)).getN('k', 0)).toEqual([])
        expect(new HashRing().getN('k', 3)).toEqual([])
    })
})
