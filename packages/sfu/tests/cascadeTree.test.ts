import { describe, expect, it, vi } from 'vitest'
import { CascadeTree, planCascadeTree } from '../src/CascadeTree.js'
import { SfuCluster } from '../src/SfuCluster.js'
import { SfuNode } from '../src/SfuNode.js'
import { CascadeTreeEvent } from '../src/types.js'

const pool = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`)

describe('planCascadeTree — pure layout', () => {
    it('single node serves viewers up to its own capacity when no fleet', () => {
        const p = planCascadeTree({
            originId: 'o',
            viewerCount: 5,
            fanout: 2,
            viewersPerNode: 10,
            availableNodeIds: [],
        })
        expect(p.tiers).toBe(1)
        expect(p.links).toEqual([])
        expect(p.servedViewers).toBe(5)
        expect(p.unmetViewers).toBe(0)
        expect(p.nodes.get('o')?.viewerSlots).toBe(5)
    })

    it('builds a balanced fan-out tree and covers all viewers', () => {
        const p = planCascadeTree({
            originId: 'o',
            viewerCount: 35,
            fanout: 2,
            viewersPerNode: 10,
            availableNodeIds: pool(20),
        })

        expect(p.tiers).toBe(3)
        expect(p.edges.length).toBe(4)
        expect(p.servedViewers).toBe(35)
        expect(p.unmetViewers).toBe(0)

        expect(p.links.length).toBe(6)

        for (const l of p.links) {
            expect(p.nodes.get(l.from)?.tier).toBeLessThan(p.nodes.get(l.to)?.tier as number)
        }
    })

    it('respects fanout — no relay exceeds it', () => {
        const p = planCascadeTree({
            originId: 'o',
            viewerCount: 10_000,
            fanout: 3,
            viewersPerNode: 100,
            availableNodeIds: pool(500),
        })
        for (const node of p.nodes.values()) {
            expect(node.children.length).toBeLessThanOrEqual(3)
        }
        expect(p.unmetViewers).toBe(0)
    })

    it('surfaces capacity shortfall when the fleet is too small', () => {
        const p = planCascadeTree({
            originId: 'o',
            viewerCount: 1000,
            fanout: 2,
            viewersPerNode: 10,
            availableNodeIds: pool(3),
        })
        expect(p.unmetViewers).toBeGreaterThan(0)
        expect(p.servedViewers + p.unmetViewers).toBe(1000)
    })

    it('scales to a million viewers with a log-depth tree', () => {
        const p = planCascadeTree({
            originId: 'o',
            viewerCount: 1_000_000,
            fanout: 8,
            viewersPerNode: 1000,
            availableNodeIds: pool(2000),
        })

        expect(p.tiers).toBeLessThanOrEqual(5)
        expect(p.unmetViewers).toBe(0)
        const totalSlots = [...p.nodes.values()].reduce((s, n) => s + n.viewerSlots, 0)
        expect(totalSlots).toBe(1_000_000)
    })

    it('viewer slots never exceed per-node capacity', () => {
        const p = planCascadeTree({
            originId: 'o',
            viewerCount: 250,
            fanout: 4,
            viewersPerNode: 30,
            availableNodeIds: pool(50),
        })
        for (const node of p.nodes.values()) {
            expect(node.viewerSlots).toBeLessThanOrEqual(30)
        }
    })

    it('rejects invalid fanout / capacity', () => {
        expect(() =>
            planCascadeTree({
                originId: 'o',
                viewerCount: 1,
                fanout: 0,
                viewersPerNode: 1,
                availableNodeIds: [],
            }),
        ).toThrow()
        expect(() =>
            planCascadeTree({
                originId: 'o',
                viewerCount: 1,
                fanout: 1,
                viewersPerNode: 0,
                availableNodeIds: [],
            }),
        ).toThrow()
    })
})

describe('CascadeTree — cluster-integrated', () => {
    function cluster(n: number): SfuCluster {
        const c = new SfuCluster()
        for (const id of ['origin', ...pool(n)])
            c.addNode(new SfuNode(id, 'us-east', { capacity: 100_000 }))
        return c
    }

    it('build emits links and leaf assignments, tracks rooms on nodes', () => {
        const c = cluster(6)
        const tree = new CascadeTree(c, { fanout: 2, viewersPerNode: 10 })
        const links: string[] = []
        const leaves: string[] = []
        tree.on(CascadeTreeEvent.LinkCreated, (_room, from, to) => links.push(`${from}>${to}`))
        tree.on(CascadeTreeEvent.LeafAssigned, (_room, id) => leaves.push(id))

        const plan = tree.build('stream1', 'origin', 35)
        expect(plan.links.length).toBe(links.length)
        expect(links.length).toBeGreaterThan(0)
        expect(leaves.length).toBe(plan.edges.length)

        for (const id of plan.nodes.keys()) {
            expect(c.nodes.find((x) => x.id === id)?.roomCount).toBeGreaterThan(0)
        }
        expect(tree.getPlan('stream1')).toBe(plan)
    })

    it('emits CapacityShortfall when the fleet cannot cover viewers', () => {
        const c = new SfuCluster()
        for (const id of ['origin', 'n0', 'n1'])
            c.addNode(new SfuNode(id, 'us-east', { capacity: 10 }))
        const tree = new CascadeTree(c, { fanout: 2, viewersPerNode: 10 })
        const shortfall = vi.fn()
        tree.on(CascadeTreeEvent.CapacityShortfall, shortfall)
        tree.build('stream1', 'origin', 10_000)
        expect(shortfall).toHaveBeenCalled()
    })

    it('honors per-node capacity when assigning viewer slots (D4)', () => {
        const c = new SfuCluster()
        c.addNode(new SfuNode('origin', 'us-east', { capacity: 1000 }))
        c.addNode(new SfuNode('big', 'us-east', { capacity: 500 }))
        c.addNode(new SfuNode('small', 'us-east', { capacity: 5 }))
        const tree = new CascadeTree(c, { fanout: 8, viewersPerNode: 1000 })
        const plan = tree.build('s', 'origin', 200)

        const small = plan.nodes.get('small')
        if (small && small.children.length === 0) expect(small.viewerSlots).toBeLessThanOrEqual(5)
    })

    it('rebuilds the tree when a participating node fails (self-heal)', () => {
        const c = cluster(10)
        const tree = new CascadeTree(c, { fanout: 2, viewersPerNode: 10 })
        const plan = tree.build('stream1', 'origin', 35)

        const victimId = [...plan.nodes.keys()].find((id) => id !== 'origin') as string
        const rebuilt = vi.fn()
        tree.on(CascadeTreeEvent.TreeBuilt, rebuilt)

        const victim = c.nodes.find((n) => n.id === victimId)
        victim?.markFailed()

        expect(rebuilt).toHaveBeenCalled()
        const after = tree.getPlan('stream1')
        expect(after?.nodes.has(victimId)).toBe(false)
        expect(after?.servedViewers).toBe(35)
    })

    it('emits OriginLost and tears down when the ORIGIN fails (no dark re-root)', () => {
        // Regression (REVIEW.md CRITICAL #3): failing the origin must not rebuild
        // the tree rooted at the dead origin — the whole broadcast would go dark
        // while reporting success.
        const c = cluster(10)
        const tree = new CascadeTree(c, { fanout: 2, viewersPerNode: 10 })
        tree.build('stream1', 'origin', 35)

        const originLost = vi.fn()
        const rebuilt = vi.fn()
        tree.on(CascadeTreeEvent.OriginLost, originLost)
        tree.on(CascadeTreeEvent.TreeBuilt, rebuilt)

        c.nodes.find((n) => n.id === 'origin')?.markFailed()

        expect(originLost).toHaveBeenCalledWith('stream1', 'origin')
        expect(rebuilt).not.toHaveBeenCalled()
        expect(tree.getPlan('stream1')).toBeUndefined()
    })

    it('detach tears down the tree and untracks nodes', () => {
        const c = cluster(6)
        const tree = new CascadeTree(c, { fanout: 2, viewersPerNode: 10 })
        const plan = tree.build('stream1', 'origin', 35)
        const dropped = vi.fn()
        tree.on(CascadeTreeEvent.TreeDropped, dropped)

        expect(tree.detach('stream1')).toBe(true)
        expect(dropped).toHaveBeenCalled()
        expect(tree.getPlan('stream1')).toBeUndefined()
        for (const id of plan.nodes.keys()) {
            expect(c.nodes.find((x) => x.id === id)?.roomCount).toBe(0)
        }
        expect(tree.detach('stream1')).toBe(false)
    })
})
