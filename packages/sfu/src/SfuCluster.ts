import { EventEmitter, MembershipReconciler } from 'rtcforge-core'
import { HealthChecker } from './HealthChecker.js'
import { LeastLoadedStrategy } from './PlacementStrategy.js'
import { SfuNode } from './SfuNode.js'
import { SfuClusterEvent, SfuNodeEvent, noopLogger } from './types.js'
import type { Logger, Membership, NodeInfo, PlacementStrategy, SfuClusterOptions } from './types.js'

type SfuClusterEvents = {
    [SfuClusterEvent.NodeAdded]: [node: SfuNode]
    [SfuClusterEvent.NodeRemoved]: [node: SfuNode]
    [SfuClusterEvent.Overloaded]: []
    [SfuClusterEvent.Error]: [err: Error]
}

type NodeEntry = { node: SfuNode; overloadListener: () => void }

/**
 * Manages a set of {@link SfuNode} instances and selects nodes for rooms via a
 * pluggable {@link PlacementStrategy}.
 *
 * The cluster can optionally reconcile its membership against an external
 * {@link Membership} source and run periodic health checks that mark failing
 * nodes as failed and trigger a rebalance. Placement always considers only
 * active nodes — those that are neither failed nor draining.
 *
 * Emits {@link SfuClusterEvent} events.
 *
 * @example
 * ```ts
 * const cluster = new SfuCluster({
 *   placementStrategy: new LeastLoadedStrategy(),
 *   healthCheck: {
 *     intervalMs: 10_000,
 *     onCheck: async (id) => probe(id),
 *   },
 *   onRebalance: (nodeId, reason) => migrateRooms(nodeId, reason),
 * })
 *
 * cluster.addNode(new SfuNode('sfu-eu-1', 'eu'))
 * cluster.addNode(new SfuNode('sfu-eu-2', 'eu'))
 * cluster.startHealthChecks()
 *
 * const node = cluster.assignNode('eu', 'room-42')
 * ```
 *
 * @remarks
 * Call {@link SfuCluster.dispose} when the cluster is no longer needed to stop
 * membership reconciliation and health checks.
 */
export class SfuCluster extends EventEmitter<SfuClusterEvents> {
    private readonly _nodes = new Map<string, NodeEntry>()
    private readonly _logger: Logger
    private readonly _opts: SfuClusterOptions
    private readonly _placement: PlacementStrategy
    private _healthChecker: HealthChecker | null = null
    private readonly _failStreak = new Map<string, number>()
    private readonly _passStreak = new Map<string, number>()
    private readonly _membership: Membership | undefined
    private readonly _nodeFactory: (info: NodeInfo) => SfuNode
    private _reconciler: MembershipReconciler | undefined

    /**
     * @param options - Placement, membership, health-check, and logging configuration.
     * When a {@link SfuClusterOptions.membership} source is supplied, membership
     * reconciliation starts immediately.
     */
    constructor(options: SfuClusterOptions = {}) {
        super()
        this._opts = options
        this._logger = options.logger ?? noopLogger
        this._placement = options.placementStrategy ?? new LeastLoadedStrategy()
        this._membership = options.membership
        this._nodeFactory =
            options.nodeFactory ?? ((info) => new SfuNode(info.id, info.region ?? 'default'))
        if (this._membership) {
            this._reconciler = new MembershipReconciler(this._membership, {
                onAdd: (info) => {
                    if (!this._nodes.has(info.id)) this.addNode(this._nodeFactory(info))
                },
                onRemove: (id) => {
                    this.removeNode(id)
                },
            })
            this._reconciler.start()
        }
    }

    /**
     * Release cluster resources: stop membership reconciliation and health
     * checks. Does not remove nodes or emit membership events.
     */
    dispose(): void {
        this._reconciler?.dispose()
        this._reconciler = undefined
        this.stopHealthChecks()
    }

    /** All nodes currently registered with the cluster, regardless of state. */
    get nodes(): SfuNode[] {
        const result: SfuNode[] = []
        for (const { node } of this._nodes.values()) result.push(node)
        return result
    }

    /**
     * Nodes eligible to serve traffic: those that are neither failed nor draining.
     *
     * @returns The active subset of {@link SfuCluster.nodes}.
     */
    getActiveNodes(): SfuNode[] {
        const result: SfuNode[] = []
        for (const { node } of this._nodes.values()) {
            if (!node.isFailed && !node.isDraining) result.push(node)
        }
        return result
    }

    /**
     * Register a node with the cluster and begin listening for its overload
     * events. Emits {@link SfuClusterEvent.NodeAdded}.
     *
     * @param node - The node to add. Re-adding an existing id replaces its entry.
     */
    addNode(node: SfuNode): void {
        const overloadListener = () => this._checkAllOverloaded()
        this._nodes.set(node.id, { node, overloadListener })
        node.on(SfuNodeEvent.Overloaded, overloadListener)
        this._logger.info('SFU node added', { id: node.id, region: node.region })
        this.emit(SfuClusterEvent.NodeAdded, node)
    }

    /**
     * Remove a node from the cluster and detach its overload listener. Emits
     * {@link SfuClusterEvent.NodeRemoved} when a node was removed.
     *
     * @param id - Identifier of the node to remove.
     * @returns `true` if a node was removed, `false` if no node had that id.
     */
    removeNode(id: string): boolean {
        const entry = this._nodes.get(id)
        if (!entry) return false
        entry.node.off(SfuNodeEvent.Overloaded, entry.overloadListener)
        this._nodes.delete(id)
        // Clear health streaks so a node id reused later (e.g. a restart via
        // MembershipReconciler onRemove→onAdd) starts fresh — otherwise a stale
        // fail-streak would trip the anti-flap threshold on its first probe.
        this._failStreak.delete(id)
        this._passStreak.delete(id)
        this._logger.info('SFU node removed', { id })
        this.emit(SfuClusterEvent.NodeRemoved, entry.node)
        return true
    }

    /**
     * Select an active node for a room using the configured placement strategy.
     *
     * @param region - Optional preferred region for region-affinity placement.
     * @param key - Optional routing key (for example a room id) for deterministic strategies.
     * @returns The chosen node, or `undefined` when no active node is available.
     */
    assignNode(region?: string, key?: string): SfuNode | undefined {
        return this._placement.select(this.getActiveNodes(), region, key)
    }

    /**
     * Start periodic health checks.
     *
     * No-op unless a {@link SfuClusterOptions.healthCheck} `onCheck` probe was
     * configured. Each sweep probes every node; a node that fails is marked
     * failed, surfaces an {@link SfuClusterEvent.Error}, and triggers
     * {@link SfuCluster.rebalance}. A previously failed node that passes is
     * marked recovered.
     */
    startHealthChecks(): void {
        const onCheck = this._opts.healthCheck?.onCheck
        if (!onCheck) return
        if (this._healthChecker === null) {
            this._healthChecker = new HealthChecker({
                nodes: () => this.nodes,
                stillRegistered: (id) => this._nodes.has(id),
                onCheck,
                onResult: (node, healthy) => this._onHealthResult(node, healthy),
                intervalMs: this._opts.healthCheck?.intervalMs ?? 30_000,
                probeTimeoutMs: this._opts.healthCheck?.probeTimeoutMs,
            })
        }
        this._healthChecker.start()
    }

    /** Stop periodic health checks if they are running. */
    stopHealthChecks(): void {
        this._healthChecker?.stop()
    }

    private _onHealthResult(node: SfuNode, healthy: boolean): void {
        // Require N consecutive results before flipping state, so a single
        // transient probe failure doesn't trigger a cluster-wide migration storm
        // (and one lucky pass doesn't prematurely un-fail a dying node).
        const failThreshold = this._opts.healthCheck?.failureThreshold ?? 3
        const recoverThreshold = this._opts.healthCheck?.recoveryThreshold ?? 2
        if (!healthy) {
            this._passStreak.delete(node.id)
            const streak = (this._failStreak.get(node.id) ?? 0) + 1
            this._failStreak.set(node.id, streak)
            if (!node.isFailed && streak >= failThreshold) {
                this._failStreak.delete(node.id)
                node.markFailed()
                this.emit(
                    SfuClusterEvent.Error,
                    new Error(`SFU node ${node.id} failed its health check`),
                )
                this.rebalance()
            }
        } else {
            this._failStreak.delete(node.id)
            if (node.isFailed) {
                const streak = (this._passStreak.get(node.id) ?? 0) + 1
                this._passStreak.set(node.id, streak)
                if (streak >= recoverThreshold) {
                    this._passStreak.delete(node.id)
                    node.markRecovered()
                }
            }
        }
    }

    /**
     * Invoke the {@link SfuClusterOptions.onRebalance} callback for every node
     * that is currently draining or failed, so the host can migrate their rooms.
     *
     * Emits {@link SfuClusterEvent.Overloaded} if at least one such node was
     * found. Called automatically when a health check fails; may also be called
     * manually.
     */
    rebalance(): void {
        let needsOverloadedEvent = false
        for (const { node } of this._nodes.values()) {
            if (node.isDraining || node.isFailed) {
                const reason: 'draining' | 'failed' = node.isFailed ? 'failed' : 'draining'
                this._opts.onRebalance?.(node.id, reason)
                needsOverloadedEvent = true
                this._logger.warn('Rebalancing node', { id: node.id, reason })
            }
        }
        if (needsOverloadedEvent) {
            this.emit(SfuClusterEvent.Overloaded)
        }
    }

    private _checkAllOverloaded(): void {
        const active = this.getActiveNodes()
        if (active.length > 0 && active.every((n) => n.isOverloaded)) {
            this._logger.warn('All SFU nodes overloaded')
            this.emit(SfuClusterEvent.Overloaded)
        }
    }
}
