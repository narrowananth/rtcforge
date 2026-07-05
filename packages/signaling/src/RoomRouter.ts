import { HashRing, MembershipReconciler } from 'rtcforge-core'
import type { Membership, NodeInfo } from './types.js'

/**
 * Options for constructing a {@link RoomRouter}.
 */
export interface RoomRouterOptions {
    /** This node's own id; always kept on the ring so local rooms route here. */
    selfId: string
    /** Cluster membership whose changes drive the routing ring. */
    membership: Membership
}

function nodeWeight(n: NodeInfo): number {
    return Math.max(1, Number(n.metadata?.capacity) || 1)
}

/**
 * Maps room ids to cluster nodes via consistent hashing over live membership.
 *
 * @remarks
 * Wraps a {@link HashRing} kept in sync with {@link Membership} through a
 * {@link MembershipReconciler}: nodes joining/leaving add or remove ring points,
 * weighted by each node's `capacity` metadata. Given a room id, the router names
 * the node that should own it, letting a signaling cluster shard rooms with
 * minimal reshuffling when the node set changes. This node's own id is always
 * present on the ring.
 */
export class RoomRouter {
    private readonly _selfId: string
    private readonly _ring = new HashRing()
    private readonly _byId = new Map<string, NodeInfo>()
    private readonly _weights = new Map<string, number>()
    private readonly _reconciler: MembershipReconciler

    constructor(opts: RoomRouterOptions) {
        this._selfId = opts.selfId
        this._ring.add(this._selfId)
        this._byId.set(this._selfId, { id: this._selfId })
        this._reconciler = new MembershipReconciler(opts.membership, {
            onAdd: (n) => this._upsert(n),
            onUpdate: (n) => this._upsert(n),
            onRemove: (id) => {
                if (id === this._selfId) return
                this._ring.remove(id)
                this._byId.delete(id)
                this._weights.delete(id)
            },
        })
        this._reconciler.start()
    }

    private _upsert(n: NodeInfo): void {
        const weight = nodeWeight(n)
        if (this._weights.get(n.id) !== weight) {
            this._ring.add({ id: n.id, weight })
            this._weights.set(n.id, weight)
        }
        this._byId.set(n.id, n)
    }

    route(roomId: string): { isLocal: boolean; owner: NodeInfo | undefined } {
        const id = this._ring.get(roomId)
        return {
            isLocal: id === this._selfId,
            owner: id !== undefined ? this._byId.get(id) : undefined,
        }
    }

    ownerId(roomId: string): string | undefined {
        return this._ring.get(roomId)
    }

    owner(roomId: string): NodeInfo | undefined {
        return this.route(roomId).owner
    }

    isLocal(roomId: string): boolean {
        return this.route(roomId).isLocal
    }

    nodeIds(): string[] {
        return this._ring.nodeIds()
    }

    dispose(): void {
        this._reconciler.dispose()
    }
}
