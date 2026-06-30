import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualClock } from '../src/Clock.js'
import { GossipMembership, GossipNetwork, InMemoryGossipTransport } from '../src/Gossip.js'
import { HashRing } from '../src/HashRing.js'
import type { NodeInfo } from '../src/Membership.js'

const ID = (id: string, address: string, region?: string): NodeInfo => ({ id, address, region })

function makeNode(
    net: GossipNetwork,
    clock: ManualClock,
    id: string,
    address: string,
    seeds: string[],
    region?: string,
) {
    const transport = new InMemoryGossipTransport(address, net)
    const m = new GossipMembership(ID(id, address, region), transport, {
        clock,
        seeds,
        gossipIntervalMs: 200,
        deadTimeoutMs: 1000,
        fanout: 3,
    })
    return m
}

const aliveIds = async (m: GossipMembership) => (await m.list()).map((n) => n.id).sort()

describe('GossipMembership — convergence', () => {
    let net: GossipNetwork
    let clock: ManualClock
    let n1: GossipMembership
    let n2: GossipMembership
    let n3: GossipMembership

    beforeEach(() => {
        net = new GossipNetwork()
        clock = new ManualClock()

        n1 = makeNode(net, clock, 'n1', 'addr1', [], 'us-east')
        n2 = makeNode(net, clock, 'n2', 'addr2', ['addr1'], 'us-east')
        n3 = makeNode(net, clock, 'n3', 'addr3', ['addr1'], 'eu-west')
        n1.start()
        n2.start()
        n3.start()
    })

    it('all nodes discover the full cluster via anti-entropy', async () => {
        clock.advance(2000)
        expect(await aliveIds(n1)).toEqual(['n1', 'n2', 'n3'])
        expect(await aliveIds(n2)).toEqual(['n1', 'n2', 'n3'])
        expect(await aliveIds(n3)).toEqual(['n1', 'n2', 'n3'])
    })

    it('propagates node attributes (region, address)', async () => {
        clock.advance(2000)
        const view = await n2.list()
        const eu = view.find((n) => n.id === 'n3')
        expect(eu?.region).toBe('eu-west')
        expect(eu?.address).toBe('addr3')
    })

    it('membership stays stable while everyone is healthy (no false death)', async () => {
        clock.advance(2000)
        clock.advance(3000)
        expect(await aliveIds(n1)).toEqual(['n1', 'n2', 'n3'])
    })

    it('watch fires as the cluster grows', async () => {
        const watcher = vi.fn()
        n1.watch(watcher)
        clock.advance(2000)
        expect(watcher).toHaveBeenCalled()
        const last = watcher.mock.lastCall?.[0] as NodeInfo[]
        expect(last.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3'])
    })
})

describe('GossipMembership — tombstone GC (no unbounded growth)', () => {
    it('forgets a dead node entirely after the tombstone window', async () => {
        const net = new GossipNetwork()
        const clock = new ManualClock()
        const n1 = new GossipMembership(
            { id: 'n1', address: 'a1' },
            new InMemoryGossipTransport('a1', net),
            {
                clock,
                gossipIntervalMs: 200,
                deadTimeoutMs: 1000,
                tombstoneMs: 2000,
            },
        )
        const n2 = makeNode(net, clock, 'n2', 'a2', ['a1'])
        n1.start()
        n2.start()
        clock.advance(2000)
        expect((await n1.list()).map((n) => n.id).sort()).toEqual(['n1', 'n2'])

        net.partition('a2')
        clock.advance(1500)
        expect((await n1.list()).map((n) => n.id)).toEqual(['n1'])
        const internal = n1 as unknown as { _members: Map<string, unknown> }
        expect(internal._members.has('n2')).toBe(true)

        clock.advance(3000)
        await n1.list()
        expect(internal._members.has('n2')).toBe(false)
    })
})

describe('GossipMembership — failure detection', () => {
    it('declares a silently crashed node dead after the timeout (partition)', async () => {
        const net = new GossipNetwork()
        const clock = new ManualClock()
        const n1 = makeNode(net, clock, 'n1', 'addr1', [])
        const n2 = makeNode(net, clock, 'n2', 'addr2', ['addr1'])
        const n3 = makeNode(net, clock, 'n3', 'addr3', ['addr1'])
        n1.start()
        n2.start()
        n3.start()
        clock.advance(2000)
        expect(await aliveIds(n1)).toEqual(['n1', 'n2', 'n3'])

        net.partition('addr3')
        clock.advance(2000)

        expect(await aliveIds(n1)).toEqual(['n1', 'n2'])
        expect(await aliveIds(n2)).toEqual(['n1', 'n2'])
    })

    it('graceful stop() announces departure and is detected immediately', async () => {
        const net = new GossipNetwork()
        const clock = new ManualClock()
        const n1 = makeNode(net, clock, 'n1', 'addr1', [])
        const n2 = makeNode(net, clock, 'n2', 'addr2', ['addr1'])
        n1.start()
        n2.start()
        clock.advance(2000)
        expect(await aliveIds(n1)).toEqual(['n1', 'n2'])

        n2.stop()
        clock.advance(400)
        expect(await aliveIds(n1)).toEqual(['n1'])
    })

    it('a node refutes a false death claim and stays alive', async () => {
        const net = new GossipNetwork()
        const clock = new ManualClock()
        const n1 = makeNode(net, clock, 'n1', 'addr1', [])
        const n2 = makeNode(net, clock, 'n2', 'addr2', ['addr1'])
        n1.start()
        n2.start()
        clock.advance(2000)

        net.partition('addr2')
        clock.advance(2000)
        expect(await aliveIds(n1)).toEqual(['n1'])

        net.heal('addr2')
        clock.advance(2000)
        expect(await aliveIds(n1)).toEqual(['n1', 'n2'])
    })
})

describe('GossipMembership + HashRing — shared-nothing routing', () => {
    it('two nodes with the converged view route every room to the same owner', async () => {
        const net = new GossipNetwork()
        const clock = new ManualClock()
        const n1 = makeNode(net, clock, 'n1', 'addr1', [])
        const n2 = makeNode(net, clock, 'n2', 'addr2', ['addr1'])
        const n3 = makeNode(net, clock, 'n3', 'addr3', ['addr1'])
        n1.start()
        n2.start()
        n3.start()
        clock.advance(2000)

        const ring1 = new HashRing(await n1.list())
        const ring2 = new HashRing(await n3.list())
        for (let i = 0; i < 200; i++) {
            const room = `room:${i}`
            expect(ring1.get(room)).toBe(ring2.get(room))
        }
    })

    it('ring rebalances after a node leaves the gossip cluster', async () => {
        const net = new GossipNetwork()
        const clock = new ManualClock()
        const n1 = makeNode(net, clock, 'n1', 'addr1', [])
        const n2 = makeNode(net, clock, 'n2', 'addr2', ['addr1'])
        const n3 = makeNode(net, clock, 'n3', 'addr3', ['addr1'])
        n1.start()
        n2.start()
        n3.start()
        clock.advance(2000)

        const before = new HashRing(await n1.list())
        net.partition('addr3')
        clock.advance(2000)
        const after = new HashRing(await n1.list())

        expect(before.size).toBe(3)
        expect(after.size).toBe(2)
        expect(after.nodeIds().sort()).toEqual(['n1', 'n2'])

        const orphan = Array.from({ length: 200 }, (_, i) => `room:${i}`).find(
            (r) => before.get(r) === 'n3',
        )
        expect(orphan).toBeDefined()
        expect(['n1', 'n2']).toContain(after.get(orphan as string))
    })
})
