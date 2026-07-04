import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CascadingRouter } from '../src/CascadingRouter.js'
import { NodeFailureTracker } from '../src/NodeFailureTracker.js'
import { SfuCluster } from '../src/SfuCluster.js'
import { SfuNode } from '../src/SfuNode.js'
import { CascadingRouterEvent, SfuClusterEvent, SfuNodeEvent } from '../src/types.js'

afterEach(() => {
    vi.useRealTimers()
})

describe('SfuNode — state', () => {
    it('load starts at 0', () => {
        const node = new SfuNode('n1', 'us-east')
        expect(node.load).toBe(0)
    })

    it('isFailed starts false', () => {
        const node = new SfuNode('n1', 'us-east')
        expect(node.isFailed).toBe(false)
    })

    it('isOverloaded is false when load < capacity', () => {
        const node = new SfuNode('n1', 'us-east', { capacity: 100 })
        node.reportLoad(50)
        expect(node.isOverloaded).toBe(false)
    })

    it('isOverloaded is true when load >= capacity', () => {
        const node = new SfuNode('n1', 'us-east', { capacity: 100 })
        node.reportLoad(100)
        expect(node.isOverloaded).toBe(true)
    })
})

describe('SfuNode — reportLoad', () => {
    it('updates load', () => {
        const node = new SfuNode('n1', 'us-east')
        node.reportLoad(42)
        expect(node.load).toBe(42)
    })

    it('emits load event with new value', () => {
        const node = new SfuNode('n1', 'us-east')
        const listener = vi.fn()
        node.on(SfuNodeEvent.Load, listener)
        node.reportLoad(30)
        expect(listener).toHaveBeenCalledWith(30)
    })

    it('emits overloaded when load reaches capacity', () => {
        const node = new SfuNode('n1', 'us-east', { capacity: 10 })
        const listener = vi.fn()
        node.on(SfuNodeEvent.Overloaded, listener)
        node.reportLoad(10)
        expect(listener).toHaveBeenCalledOnce()
    })

    it('does not emit overloaded when load is below capacity', () => {
        const node = new SfuNode('n1', 'us-east', { capacity: 10 })
        const listener = vi.fn()
        node.on(SfuNodeEvent.Overloaded, listener)
        node.reportLoad(9)
        expect(listener).not.toHaveBeenCalled()
    })
})

describe('SfuNode — markFailed / markRecovered', () => {
    it('markFailed sets isFailed and emits failed', () => {
        const node = new SfuNode('n1', 'us-east')
        const listener = vi.fn()
        node.on(SfuNodeEvent.Failed, listener)
        node.markFailed()
        expect(node.isFailed).toBe(true)
        expect(listener).toHaveBeenCalledOnce()
    })

    it('markFailed is idempotent — second call is no-op', () => {
        const node = new SfuNode('n1', 'us-east')
        const listener = vi.fn()
        node.on(SfuNodeEvent.Failed, listener)
        node.markFailed()
        node.markFailed()
        expect(listener).toHaveBeenCalledOnce()
    })

    it('markRecovered clears isFailed and emits recovered', () => {
        const node = new SfuNode('n1', 'us-east')
        const listener = vi.fn()
        node.on(SfuNodeEvent.Recovered, listener)
        node.markFailed()
        node.markRecovered()
        expect(node.isFailed).toBe(false)
        expect(listener).toHaveBeenCalledOnce()
    })

    it('markRecovered is idempotent when not failed', () => {
        const node = new SfuNode('n1', 'us-east')
        const listener = vi.fn()
        node.on(SfuNodeEvent.Recovered, listener)
        node.markRecovered()
        expect(listener).not.toHaveBeenCalled()
    })
})

describe('SfuCluster — node management', () => {
    let cluster: SfuCluster

    beforeEach(() => {
        cluster = new SfuCluster()
    })

    it('nodes starts empty', () => {
        expect(cluster.nodes).toHaveLength(0)
    })

    it('addNode emits nodeAdded', () => {
        const listener = vi.fn()
        cluster.on(SfuClusterEvent.NodeAdded, listener)
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        expect(listener).toHaveBeenCalledWith(node)
    })

    it('addNode makes node available via nodes getter', () => {
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        expect(cluster.nodes).toContain(node)
    })

    it('removeNode emits nodeRemoved and returns true', () => {
        const listener = vi.fn()
        cluster.on(SfuClusterEvent.NodeRemoved, listener)
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        const result = cluster.removeNode('n1')
        expect(result).toBe(true)
        expect(listener).toHaveBeenCalledWith(node)
    })

    it('removeNode returns false for unknown id', () => {
        expect(cluster.removeNode('ghost')).toBe(false)
    })

    it('removeNode removes node from nodes getter', () => {
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        cluster.removeNode('n1')
        expect(cluster.nodes).not.toContain(node)
    })
})

describe('SfuCluster — assignNode', () => {
    let cluster: SfuCluster

    beforeEach(() => {
        cluster = new SfuCluster()
    })

    it('returns undefined when cluster is empty', () => {
        expect(cluster.assignNode()).toBeUndefined()
    })

    it('returns undefined when all nodes are failed', () => {
        const node = new SfuNode('n1', 'us-east')
        node.markFailed()
        cluster.addNode(node)
        expect(cluster.assignNode()).toBeUndefined()
    })

    it('returns the least-loaded node', () => {
        const n1 = new SfuNode('n1', 'us-east')
        const n2 = new SfuNode('n2', 'us-east')
        n1.reportLoad(80)
        n2.reportLoad(20)
        cluster.addNode(n1)
        cluster.addNode(n2)
        expect(cluster.assignNode()).toBe(n2)
    })

    it('prefers nodes in the requested region', () => {
        const usNode = new SfuNode('us', 'us-east')
        const euNode = new SfuNode('eu', 'eu-west')
        cluster.addNode(usNode)
        cluster.addNode(euNode)
        expect(cluster.assignNode('eu-west')).toBe(euNode)
    })

    it('falls back to any region when preferred region has no nodes', () => {
        const usNode = new SfuNode('us', 'us-east')
        cluster.addNode(usNode)
        expect(cluster.assignNode('eu-west')).toBe(usNode)
    })

    it('skips failed nodes during assignment', () => {
        const n1 = new SfuNode('n1', 'us-east')
        const n2 = new SfuNode('n2', 'us-east')
        n1.markFailed()
        n1.reportLoad(0)
        n2.reportLoad(50)
        cluster.addNode(n1)
        cluster.addNode(n2)
        expect(cluster.assignNode()).toBe(n2)
    })

    it('emits overloaded when all active nodes exceed capacity', () => {
        const listener = vi.fn()
        cluster.on(SfuClusterEvent.Overloaded, listener)
        const n1 = new SfuNode('n1', 'us-east', { capacity: 10 })
        const n2 = new SfuNode('n2', 'us-east', { capacity: 10 })
        cluster.addNode(n1)
        cluster.addNode(n2)
        n1.reportLoad(10)
        n2.reportLoad(10)
        expect(listener).toHaveBeenCalled()
    })
})

describe('CascadingRouter — attachRoom', () => {
    let cluster: SfuCluster
    let router: CascadingRouter
    let node: SfuNode

    beforeEach(() => {
        cluster = new SfuCluster()
        node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        router = new CascadingRouter(cluster)
    })

    it('returns the assigned SfuNode', () => {
        const assigned = router.attachRoom('room-1')
        expect(assigned).toBe(node)
    })

    it('emits roomAssigned on first attach', () => {
        const listener = vi.fn()
        router.on(CascadingRouterEvent.RoomAssigned, listener)
        router.attachRoom('room-1')
        expect(listener).toHaveBeenCalledWith('room-1', node)
    })

    it('getAssignment returns the assigned node', () => {
        router.attachRoom('room-1')
        expect(router.getAssignment('room-1')).toBe(node)
    })

    it('assignmentCount increments per new room', () => {
        router.attachRoom('room-1')
        router.attachRoom('room-2')
        expect(router.assignmentCount).toBe(2)
    })

    it('throws when no node available', () => {
        const emptyCluster = new SfuCluster()
        const r = new CascadingRouter(emptyCluster)
        expect(() => r.attachRoom('room-1')).toThrow('No available SFU node')
    })
})

describe('CascadingRouter — cascade', () => {
    it('emits cascadeCreated when attachRoom called for already-assigned room targeting different node', () => {
        const cluster = new SfuCluster()
        const n1 = new SfuNode('n1', 'us-east')
        const n2 = new SfuNode('n2', 'eu-west')
        cluster.addNode(n1)
        cluster.addNode(n2)

        const router = new CascadingRouter(cluster)

        n2.markFailed()
        router.attachRoom('room-1')

        n2.markRecovered()
        n1.reportLoad(100)

        const listener = vi.fn()
        router.on(CascadingRouterEvent.CascadeCreated, listener)

        router.attachRoom('room-1', 'eu-west')
        expect(listener).toHaveBeenCalledWith('room-1', n1, n2)
    })

    it('does not emit cascadeCreated when same node is returned', () => {
        const cluster = new SfuCluster()
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        const router = new CascadingRouter(cluster)

        router.attachRoom('room-1')
        const listener = vi.fn()
        router.on(CascadingRouterEvent.CascadeCreated, listener)

        router.attachRoom('room-1')
        expect(listener).not.toHaveBeenCalled()
    })
})

describe('CascadingRouter — detachRoom', () => {
    it('emits roomDetached and returns true', () => {
        const cluster = new SfuCluster()
        cluster.addNode(new SfuNode('n1', 'us-east'))
        const router = new CascadingRouter(cluster)
        router.attachRoom('room-1')

        const listener = vi.fn()
        router.on(CascadingRouterEvent.RoomDetached, listener)

        const result = router.detachRoom('room-1')
        expect(result).toBe(true)
        expect(listener).toHaveBeenCalledWith('room-1')
    })

    it('returns false for unknown room', () => {
        const cluster = new SfuCluster()
        cluster.addNode(new SfuNode('n1', 'us-east'))
        const router = new CascadingRouter(cluster)
        expect(router.detachRoom('ghost')).toBe(false)
    })

    it('getAssignment returns undefined after detach', () => {
        const cluster = new SfuCluster()
        cluster.addNode(new SfuNode('n1', 'us-east'))
        const router = new CascadingRouter(cluster)
        router.attachRoom('room-1')
        router.detachRoom('room-1')
        expect(router.getAssignment('room-1')).toBeUndefined()
    })

    it('assignmentCount decrements after detach', () => {
        const cluster = new SfuCluster()
        cluster.addNode(new SfuNode('n1', 'us-east'))
        const router = new CascadingRouter(cluster)
        router.attachRoom('room-1')
        router.attachRoom('room-2')
        router.detachRoom('room-1')
        expect(router.assignmentCount).toBe(1)
    })
})

describe('SfuNode — drain() timeout resets _draining flag', () => {
    it('allows second drain() call after timeout exhausts first drain', async () => {
        vi.useFakeTimers()
        const node = new SfuNode('n1', 'us-east')

        node.trackRoom('room-1')

        const p1 = node.drain(1000)
        expect(node.isDraining).toBe(true)

        vi.advanceTimersByTime(1001)
        await p1

        expect(node.isDraining).toBe(false)

        node.untrackRoom('room-1')
        const drainedListener = vi.fn()
        node.on(SfuNodeEvent.Drained, drainedListener)
        await node.drain(1000)

        expect(drainedListener).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
    })
})

describe('CascadingRouter — node failure clears all room assignments', () => {
    it('clears multiple rooms assigned to same node when node fails', () => {
        const cluster = new SfuCluster()
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        const router = new CascadingRouter(cluster)

        router.attachRoom('room-1')
        router.attachRoom('room-2')
        router.attachRoom('room-3')
        expect(router.assignmentCount).toBe(3)

        const detachedListener = vi.fn()
        router.on(CascadingRouterEvent.RoomDetached, detachedListener)

        node.markFailed()

        expect(router.assignmentCount).toBe(0)
        expect(detachedListener).toHaveBeenCalledTimes(3)
    })

    it('does not skip rooms when RoomDetached listener modifies router', () => {
        const cluster = new SfuCluster()
        const node = new SfuNode('n1', 'us-east')
        const n2 = new SfuNode('n2', 'us-east')
        cluster.addNode(node)
        cluster.addNode(n2)
        const router = new CascadingRouter(cluster)

        router.attachRoom('room-1')
        router.attachRoom('room-2')

        router.on(CascadingRouterEvent.RoomDetached, (roomId) => {
            router.attachRoom(roomId)
        })

        node.markFailed()

        expect(router.getAssignment('room-1')).toBe(n2)
        expect(router.getAssignment('room-2')).toBe(n2)
    })
})

describe('NodeFailureTracker', () => {
    it('fires onGone once per failure despite Failed + NodeRemoved both firing', () => {
        const cluster = new SfuCluster()
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        const onGone = vi.fn()
        new NodeFailureTracker(cluster, onGone)

        node.markFailed()
        cluster.removeNode('n1')

        expect(onGone).toHaveBeenCalledTimes(1)
    })

    it('re-fires onGone after a node with the same id rejoins and fails again', () => {
        const cluster = new SfuCluster()
        const onGone = vi.fn()
        new NodeFailureTracker(cluster, onGone)

        const first = new SfuNode('n1', 'us-east')
        cluster.addNode(first)
        first.markFailed()
        cluster.removeNode('n1')
        expect(onGone).toHaveBeenCalledTimes(1)

        const second = new SfuNode('n1', 'us-east')
        cluster.addNode(second)
        second.markFailed()
        expect(onGone).toHaveBeenCalledTimes(2)
    })

    it('re-fires onGone after recovery then a new failure', () => {
        const cluster = new SfuCluster()
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        const onGone = vi.fn()
        new NodeFailureTracker(cluster, onGone)

        node.markFailed()
        expect(onGone).toHaveBeenCalledTimes(1)
        node.markRecovered()
        node.markFailed()
        expect(onGone).toHaveBeenCalledTimes(2)
    })
})

describe('SfuCluster — health check', () => {
    it('emits error and fails the node when a health check fails', async () => {
        vi.useFakeTimers()
        const cluster = new SfuCluster({
            healthCheck: { intervalMs: 100, onCheck: async () => false, failureThreshold: 1 },
        })
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        const onError = vi.fn()
        cluster.on(SfuClusterEvent.Error, onError)

        cluster.startHealthChecks()
        await vi.advanceTimersByTimeAsync(120)

        expect(node.isFailed).toBe(true)
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('n1') }),
        )

        cluster.stopHealthChecks()
        vi.useRealTimers()
    })

    it('recovers a node when its health check passes again', async () => {
        vi.useFakeTimers()
        let healthy = false
        const cluster = new SfuCluster({
            healthCheck: {
                intervalMs: 100,
                onCheck: async () => healthy,
                failureThreshold: 1,
                recoveryThreshold: 1,
            },
        })
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)

        cluster.startHealthChecks()
        await vi.advanceTimersByTimeAsync(120)
        expect(node.isFailed).toBe(true)

        healthy = true
        await vi.advanceTimersByTimeAsync(120)
        expect(node.isFailed).toBe(false)

        cluster.stopHealthChecks()
        vi.useRealTimers()
    })

    it('does not fail a node until the failure threshold is reached (anti-flap)', async () => {
        vi.useFakeTimers()
        let calls = 0
        const cluster = new SfuCluster({
            // Fail the first two sweeps, then recover — default threshold is 3,
            // so the node must never be marked failed.
            healthCheck: { intervalMs: 100, onCheck: async () => ++calls > 2 },
        })
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)
        const onError = vi.fn()
        cluster.on(SfuClusterEvent.Error, onError)

        cluster.startHealthChecks()
        await vi.advanceTimersByTimeAsync(350)

        expect(node.isFailed).toBe(false)
        expect(onError).not.toHaveBeenCalled()

        cluster.stopHealthChecks()
        vi.useRealTimers()
    })

    it('fails a node after failureThreshold consecutive failures', async () => {
        vi.useFakeTimers()
        const cluster = new SfuCluster({
            healthCheck: { intervalMs: 100, onCheck: async () => false, failureThreshold: 3 },
        })
        const node = new SfuNode('n1', 'us-east')
        cluster.addNode(node)

        cluster.startHealthChecks()
        await vi.advanceTimersByTimeAsync(120)
        expect(node.isFailed).toBe(false)
        await vi.advanceTimersByTimeAsync(200)
        expect(node.isFailed).toBe(true)

        cluster.stopHealthChecks()
        vi.useRealTimers()
    })

    it('clears health streaks on removeNode so a reused id starts fresh', async () => {
        // Regression (re-review): a stale fail-streak from a prior incarnation
        // must not trip the threshold on a restarted node's first probe.
        vi.useFakeTimers()
        const healthy = false
        const cluster = new SfuCluster({
            healthCheck: { intervalMs: 100, onCheck: async () => healthy, failureThreshold: 3 },
        })
        cluster.addNode(new SfuNode('n1', 'us-east'))
        cluster.startHealthChecks()
        await vi.advanceTimersByTimeAsync(220) // 2 failed sweeps → _failStreak['n1'] = 2
        cluster.stopHealthChecks()

        cluster.removeNode('n1') // must clear the streak
        const fresh = new SfuNode('n1', 'us-east')
        cluster.addNode(fresh)
        cluster.startHealthChecks()
        await vi.advanceTimersByTimeAsync(120) // one failed sweep on the fresh node
        expect(fresh.isFailed).toBe(false) // would be true if streak leaked (2+1≥3)

        cluster.stopHealthChecks()
        vi.useRealTimers()
    })
})
