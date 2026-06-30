import type { Membership, NodeInfo } from './Membership.js'

export interface MembershipReconcilerHandlers {
    onAdd(node: NodeInfo): void
    onRemove(id: string): void
    onUpdate?(node: NodeInfo): void
}

export class MembershipReconciler {
    private readonly _ids = new Set<string>()
    private _seen = false
    private _unwatch: (() => void) | undefined

    constructor(
        private readonly _membership: Membership,
        private readonly _handlers: MembershipReconcilerHandlers,
    ) {}

    start(): void {
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
