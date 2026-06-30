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

export class SfuCluster extends EventEmitter<SfuClusterEvents> {
    private readonly _nodes = new Map<string, NodeEntry>()
    private readonly _logger: Logger
    private readonly _opts: SfuClusterOptions
    private readonly _placement: PlacementStrategy
    private _healthChecker: HealthChecker | null = null
    private readonly _membership: Membership | undefined
    private readonly _nodeFactory: (info: NodeInfo) => SfuNode
    private _reconciler: MembershipReconciler | undefined

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

    dispose(): void {
        this._reconciler?.dispose()
        this._reconciler = undefined
        this.stopHealthChecks()
    }

    get nodes(): SfuNode[] {
        const result: SfuNode[] = []
        for (const { node } of this._nodes.values()) result.push(node)
        return result
    }

    getActiveNodes(): SfuNode[] {
        const result: SfuNode[] = []
        for (const { node } of this._nodes.values()) {
            if (!node.isFailed && !node.isDraining) result.push(node)
        }
        return result
    }

    addNode(node: SfuNode): void {
        const overloadListener = () => this._checkAllOverloaded()
        this._nodes.set(node.id, { node, overloadListener })
        node.on(SfuNodeEvent.Overloaded, overloadListener)
        this._logger.info('SFU node added', { id: node.id, region: node.region })
        this.emit(SfuClusterEvent.NodeAdded, node)
    }

    removeNode(id: string): boolean {
        const entry = this._nodes.get(id)
        if (!entry) return false
        entry.node.off(SfuNodeEvent.Overloaded, entry.overloadListener)
        this._nodes.delete(id)
        this._logger.info('SFU node removed', { id })
        this.emit(SfuClusterEvent.NodeRemoved, entry.node)
        return true
    }

    assignNode(region?: string, key?: string): SfuNode | undefined {
        return this._placement.select(this.getActiveNodes(), region, key)
    }

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
            })
        }
        this._healthChecker.start()
    }

    stopHealthChecks(): void {
        this._healthChecker?.stop()
    }

    private _onHealthResult(node: SfuNode, healthy: boolean): void {
        if (!healthy) {
            if (!node.isFailed) {
                node.markFailed()
                this.emit(
                    SfuClusterEvent.Error,
                    new Error(`SFU node ${node.id} failed its health check`),
                )
                this.rebalance()
            }
        } else if (node.isFailed) {
            node.markRecovered()
        }
    }

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
