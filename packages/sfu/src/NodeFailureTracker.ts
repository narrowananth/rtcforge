import type { SfuCluster } from './SfuCluster.js'
import type { SfuNode } from './SfuNode.js'
import { SfuClusterEvent, SfuNodeEvent } from './types.js'

interface NodeListeners {
    failed: () => void
    recovered: () => void
}

/**
 * Watches an {@link SfuCluster} and fires a callback when a node is lost unexpectedly.
 *
 * @remarks
 * Subscribes to each node's failure/recovery signals and to cluster add/remove
 * events, invoking `onGone` exactly once when a node fails or is removed without
 * first draining. A node that leaves gracefully (`isDraining`) does not trigger
 * the callback, and de-duplication prevents repeated fires for the same node.
 * Used to trigger room migration off dead nodes.
 */
export class NodeFailureTracker {
    private readonly _listeners = new Map<string, NodeListeners>()
    private readonly _gone = new Set<string>()
    private readonly _onNodeAdded: (node: SfuNode) => void
    private readonly _onNodeRemoved: (node: SfuNode) => void

    constructor(
        private readonly _cluster: SfuCluster,
        private readonly _onGone: (node: SfuNode) => void,
    ) {
        for (const node of _cluster.nodes) this._attach(node)
        this._onNodeAdded = (node) => this._attach(node)
        this._onNodeRemoved = (node) => {
            this._detach(node)
            if (!node.isDraining) this._fireGone(node)
        }
        _cluster.on(SfuClusterEvent.NodeAdded, this._onNodeAdded)
        _cluster.on(SfuClusterEvent.NodeRemoved, this._onNodeRemoved)
    }

    private _fireGone(node: SfuNode): void {
        if (this._gone.has(node.id)) return
        this._gone.add(node.id)
        this._onGone(node)
    }

    private _attach(node: SfuNode): void {
        if (this._listeners.has(node.id)) return
        this._gone.delete(node.id)
        const failed = () => this._fireGone(node)
        const recovered = () => this._gone.delete(node.id)
        this._listeners.set(node.id, { failed, recovered })
        node.on(SfuNodeEvent.Failed, failed)
        node.on(SfuNodeEvent.Recovered, recovered)
    }

    private _detach(node: SfuNode): void {
        const listeners = this._listeners.get(node.id)
        if (listeners) {
            node.off(SfuNodeEvent.Failed, listeners.failed)
            node.off(SfuNodeEvent.Recovered, listeners.recovered)
            this._listeners.delete(node.id)
        }
    }

    dispose(): void {
        this._cluster.off(SfuClusterEvent.NodeAdded, this._onNodeAdded)
        this._cluster.off(SfuClusterEvent.NodeRemoved, this._onNodeRemoved)
        for (const node of this._cluster.nodes) this._detach(node)
        this._listeners.clear()
        this._gone.clear()
    }
}
