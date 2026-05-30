import { EventEmitter } from '@rtcforge/core'
import type { SfuNode } from './SfuNode.js'
import { SfuClusterEvent, SfuNodeEvent, noopLogger } from './types.js'
import type { Logger, SfuClusterOptions } from './types.js'

type SfuClusterEvents = {
    [SfuClusterEvent.NodeAdded]: [node: SfuNode]
    [SfuClusterEvent.NodeRemoved]: [node: SfuNode]
    [SfuClusterEvent.Overloaded]: []
}

type NodeEntry = { node: SfuNode; overloadListener: () => void }

export class SfuCluster extends EventEmitter<SfuClusterEvents> {
    private readonly _nodes = new Map<string, NodeEntry>()
    private readonly _logger: Logger
    private readonly opts: SfuClusterOptions
    private _healthTimer: ReturnType<typeof setInterval> | null = null
    private readonly _inFlightChecks = new Set<string>()

    constructor(options: SfuClusterOptions = {}) {
        super()
        this.opts = options
        this._logger = options.logger ?? noopLogger
    }

    get nodes(): SfuNode[] {
        const result: SfuNode[] = []
        for (const { node } of this._nodes.values()) result.push(node)
        return result
    }

    private _getActiveNodes(): SfuNode[] {
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

    /**
     * Assigns the best available SFU node for the given room.
     * Returns `undefined` when no nodes are registered or all nodes are draining.
     *
     * Overloaded nodes are intentionally NOT excluded — the cluster always picks the
     * least-loaded candidate so traffic is never hard-rejected solely due to load.
     * Callers may read `node.isOverloaded` after assignment to warn or apply backpressure.
     */
    assignNode(region?: string): SfuNode | undefined {
        const active = this._getActiveNodes()
        if (active.length === 0) return undefined

        const regional = region ? active.filter((n) => n.region === region) : active
        const candidates = regional.length > 0 ? regional : active

        return candidates.reduce((min, n) => (n.load < min.load ? n : min))
    }

    startHealthChecks(): void {
        if (!this.opts.healthCheck?.onCheck) return
        if (this._healthTimer !== null) return
        const interval = this.opts.healthCheck.intervalMs ?? 30_000
        this._healthTimer = setInterval(() => {
            const checks: Promise<void>[] = []
            for (const { node } of this._nodes.values()) {
                if (node.isDraining || this._inFlightChecks.has(node.id)) continue
                checks.push(
                    (async () => {
                        this._inFlightChecks.add(node.id)
                        try {
                            const healthy = await this.opts.healthCheck?.onCheck?.(node.id)
                            if (!this._nodes.has(node.id)) return
                            if (!healthy) {
                                if (!node.isFailed) {
                                    node.markFailed()
                                    this.rebalance()
                                }
                            } else if (node.isFailed) {
                                node.markRecovered()
                            }
                        } catch {
                            if (!this._nodes.has(node.id)) return
                            if (!node.isFailed) {
                                node.markFailed()
                                this.rebalance()
                            }
                        } finally {
                            this._inFlightChecks.delete(node.id)
                        }
                    })(),
                )
            }
            void Promise.allSettled(checks)
        }, interval)
        this._healthTimer.unref()
    }

    stopHealthChecks(): void {
        if (this._healthTimer !== null) {
            clearInterval(this._healthTimer)
            this._healthTimer = null
        }
    }

    /**
     * Triggers room reassignment from failed/draining nodes to healthy ones.
     * Calls `onRebalance` option for each affected node so callers can coordinate
     * with CascadingRouter. Also emits `SfuClusterEvent.Overloaded` when cluster
     * capacity is impacted.
     */
    rebalance(): void {
        let needsOverloadedEvent = false
        for (const { node } of this._nodes.values()) {
            if (node.isDraining || node.isFailed) {
                const reason: 'draining' | 'failed' = node.isFailed ? 'failed' : 'draining'
                this.opts.onRebalance?.(node.id, reason)
                needsOverloadedEvent = true
                this._logger.warn('Rebalancing node', { id: node.id, reason })
            }
        }
        if (needsOverloadedEvent) {
            this.emit(SfuClusterEvent.Overloaded)
        }
    }

    private _checkAllOverloaded(): void {
        const active = this._getActiveNodes()
        if (active.length > 0 && active.every((n) => n.isOverloaded)) {
            this._logger.warn('All SFU nodes overloaded')
            this.emit(SfuClusterEvent.Overloaded)
        }
    }
}
