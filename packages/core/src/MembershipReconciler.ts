import type { Membership, NodeInfo } from './Membership.js'

/**
 * Callbacks invoked by {@link MembershipReconciler} for each discrete membership change.
 */
export interface MembershipReconcilerHandlers {
    /** Called when a node not previously seen appears in the live set. */
    onAdd(node: NodeInfo): void
    /** Called when a previously-tracked node disappears from the live set. */
    onRemove(id: string): void
    /** Called when an already-tracked node reappears in a later snapshot; optional. */
    onUpdate?(node: NodeInfo): void
}

/**
 * Turns successive {@link Membership} snapshots into discrete add/remove/update
 * callbacks.
 *
 * @remarks
 * `Membership.watch` delivers the full live node set on every change;
 * reconciling that against the previous set is boilerplate every consumer would
 * otherwise repeat. This diffs consecutive snapshots and invokes
 * {@link MembershipReconcilerHandlers} `onAdd`/`onRemove`/`onUpdate` for exactly
 * what changed. Call {@link MembershipReconciler.start} to subscribe and the
 * returned/`stop` to unsubscribe.
 */
export class MembershipReconciler {
    private readonly _ids = new Set<string>()
    private _seen = false
    private _unwatch: (() => void) | undefined
    private _syncing = false
    private _pending: { nodes: NodeInfo[]; allowRemove: boolean } | null = null

    constructor(
        private readonly _membership: Membership,
        private readonly _handlers: MembershipReconcilerHandlers,
    ) {}

    start(): void {
        // Re-entrancy guard: a second start() would leak the first watch.
        if (this._unwatch) return
        this._unwatch = this._membership.watch((nodes) => {
            this._seen = true
            this._sync(nodes, true)
        })
        void this._membership.list().then((nodes) => {
            if (!this._seen) this._sync(nodes, false)
        })
    }

    get trackedIds(): ReadonlySet<string> {
        return this._ids
    }

    private _sync(nodes: NodeInfo[], allowRemove: boolean): void {
        // A handler (onAdd/onRemove/onUpdate) may synchronously mutate membership,
        // re-entering _sync mid-loop and corrupting _ids (double onAdd / missed
        // onRemove). Serialize: if already syncing, keep only the latest snapshot
        // and process it after the current pass completes.
        if (this._syncing) {
            this._pending = { nodes, allowRemove }
            return
        }
        this._syncing = true
        try {
            this._apply(nodes, allowRemove)
        } finally {
            this._syncing = false
        }
        if (this._pending) {
            const next = this._pending
            this._pending = null
            this._sync(next.nodes, next.allowRemove)
        }
    }

    private _apply(nodes: NodeInfo[], allowRemove: boolean): void {
        const live = new Set<string>()
        for (const node of nodes) {
            live.add(node.id)
            if (this._ids.has(node.id)) {
                this._handlers.onUpdate?.(node)
            } else {
                this._ids.add(node.id)
                this._handlers.onAdd(node)
            }
        }
        if (!allowRemove) return
        for (const id of [...this._ids]) {
            if (!live.has(id)) {
                this._ids.delete(id)
                this._handlers.onRemove(id)
            }
        }
    }

    dispose(): void {
        this._unwatch?.()
        this._unwatch = undefined
    }
}
