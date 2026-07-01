import { ManualClock, MemoryMembership } from 'rtcforge-core'
import { describe, expect, it } from 'vitest'
import { CascadingRouter } from '../src/CascadingRouter.js'
import { HashRingStrategy } from '../src/PlacementStrategy.js'
import { SfuCluster } from '../src/SfuCluster.js'
import { SfuNode } from '../src/SfuNode.js'

const rooms = (n: number) => Array.from({ length: n }, (_, i) => `room:${i}`)

describe('HashRingStrategy — deterministic placement', () => {
    it('places a room on the same node regardless of controller', () => {
        const s = new HashRingStrategy()
        const nodesA = ['a', 'b', 'c', 'd'].map((id) => new SfuNode(id, 'us-east'))
        const nodesB = ['d', 'c', 'b', 'a'].map((id) => new SfuNode(id, 'us-east'))
        for (const r of rooms(200)) {
            expect(s.select(nodesA, undefined, r)?.id).toBe(s.select(nodesB, undefined, r)?.id)
        }
    })

    it('spreads rooms across nodes', () => {
        const s = new HashRingStrategy()
        const nodes = ['a', 'b', 'c', 'd'].map((id) => new SfuNode(id, 'us-east'))
        const seen = new Set<string>()
        for (const r of rooms(200)) seen.add(s.select(nodes, undefined, r)?.id as string)
        expect(seen.size).toBe(4)
    })

    it('respects region filter', () => {
        const s = new HashRingStrategy()
        const nodes = [
            new SfuNode('us1', 'us-east'),
            new SfuNode('eu1', 'eu-west'),
            new SfuNode('eu2', 'eu-west'),
        ]
        for (const r of rooms(50)) {
            expect(s.select(nodes, 'eu-west', r)?.region).toBe('eu-west')
        }
    })

    it('only the failed node’s rooms move when a node leaves', () => {
        const s = new HashRingStrategy()
        const all = ['a', 'b', 'c', 'd'].map((id) => new SfuNode(id, 'us-east'))
        const fewer = all.filter((n) => n.id !== 'c')
        let movedFromOthers = 0
        for (const r of rooms(400)) {
            const before = s.select(all, undefined, r)?.id
            const after = s.select(fewer, undefined, r)?.id
            if (before !== after && before !== 'c') movedFromOthers++
        }
        expect(movedFromOthers).toBe(0)
    })
})

describe('SfuCluster — membership-driven node set (gossip/shared-nothing)', () => {
    it('auto-adds and removes nodes as the fleet changes', async () => {
        const clock = new ManualClock()
        const membership = new MemoryMembership(clock)
        const cluster = new SfuCluster({ membership })

        await membership.register({ id: 'n1', region: 'us-east' }, 1000)
        await membership.register({ id: 'n2', region: 'eu-west' }, 5000)
        expect(cluster.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2'])

        clock.advance(1500)
        await membership.list()
        expect(cluster.nodes.map((n) => n.id)).toEqual(['n2'])
    })

    it('does not reap nodes added manually via addNode()', async () => {
        const membership = new MemoryMembership()
        const cluster = new SfuCluster({ membership })
        cluster.addNode(new SfuNode('manual', 'us-east'))
        await membership.register({ id: 'gossiped', region: 'us-east' }, 1000)
        await membership.deregister('gossiped')
        expect(cluster.nodes.map((n) => n.id)).toEqual(['manual'])
    })

    it('uses a custom nodeFactory for discovered members', async () => {
        const membership = new MemoryMembership()
        const cluster = new SfuCluster({
            membership,
            nodeFactory: (info) =>
                new SfuNode(info.id, info.region ?? 'default', { capacity: 500 }),
        })
        await membership.register({ id: 'n1', region: 'us-east' }, 1000)
        expect(cluster.nodes[0].capacity).toBe(500)
    })
})

describe('CascadingRouter + HashRingStrategy — deterministic room ownership', () => {
    it('two independent controllers assign each room to the same node', () => {
        const build = () => {
            const cluster = new SfuCluster({ placementStrategy: new HashRingStrategy() })
            for (const id of ['a', 'b', 'c']) cluster.addNode(new SfuNode(id, 'us-east'))
            return new CascadingRouter(cluster)
        }
        const r1 = build()
        const r2 = build()
        for (const room of rooms(100)) {
            expect(r1.attachRoom(room).id).toBe(r2.attachRoom(room).id)
        }
    })
})
