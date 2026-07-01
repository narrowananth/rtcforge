import { EventEmitter, InvalidArgumentError } from 'rtcforge-core'
import { NodeFailureTracker } from './NodeFailureTracker.js'
import type { SfuCluster } from './SfuCluster.js'
import type { SfuNode } from './SfuNode.js'
import { CascadeTreeEvent, noopLogger } from './types.js'
import type { CascadeTreeOptions, Logger } from './types.js'

/**
 * Role of a node within a cascade fan-out tree.
 *
 * - `origin` — the root that ingests the source media (the primary SFU).
 * - `relay` — an interior node that forwards media to child nodes.
 * - `edge` — a leaf node that serves viewers directly.
 */
export type CascadeRole = 'origin' | 'relay' | 'edge'

/**
 * A single node within a {@link CascadePlan}.
 */
export interface CascadePlanNode {
    /** Node identifier. */
    id: string
    /** The node's role in the tree. */
    role: CascadeRole
    /** Identifier of this node's parent, or `undefined` for the origin. */
    parentId?: string
    /** Identifiers of this node's child nodes. */
    children: string[]
    /** Depth of the node in the tree; the origin sits at tier `0`. */
    tier: number
    /** Number of viewers this node serves directly (non-zero only for leaves). */
    viewerSlots: number
}

/**
 * A directed parent-to-child forwarding edge in a {@link CascadePlan}.
 */
export interface CascadeLink {
    /** Identifier of the parent (forwarding) node. */
    from: string
    /** Identifier of the child (receiving) node. */
    to: string
}

/**
 * The computed fan-out plan for distributing a room's media across a tree of
 * SFU nodes.
 */
export interface CascadePlan {
    /** Identifier of the origin (root) node. */
    origin: string
    /** All nodes in the tree, keyed by node id. */
    nodes: Map<string, CascadePlanNode>
    /** All parent-to-child forwarding links. */
    links: CascadeLink[]
    /** Identifiers of leaf nodes that were assigned at least one viewer. */
    edges: string[]
    /** Total number of tiers in the tree (origin tier included). */
    tiers: number
    /** Number of viewers the plan can seat. */
    servedViewers: number
    /** Number of viewers that could not be seated due to insufficient capacity. */
    unmetViewers: number
}

/**
 * Compute a balanced cascade fan-out tree that distributes a room's media to a
 * large viewer population across many SFU nodes.
 *
 * Starting from the origin, nodes are drawn from `availableNodeIds` and attached
 * tier by tier, each parent taking up to `fanout` children, until the current
 * tier can seat `viewerCount` viewers (at `viewersPerNode` each) or the node
 * pool is exhausted. Leaf nodes are then filled with viewer slots up to their
 * per-node capacity. This shallow, wide tree keeps forwarding hops low while
 * scaling to very large audiences (for example a live stream to 1M viewers).
 *
 * @param params - Planning inputs.
 * @param params.originId - Identifier of the origin node (tree root).
 * @param params.viewerCount - Total number of viewers to seat.
 * @param params.fanout - Maximum children per node; must be `>= 1`.
 * @param params.viewersPerNode - Default viewer capacity per node (and the origin's assumed capacity); must be `>= 1`.
 * @param params.availableNodeIds - Candidate node ids to draw from (the origin is excluded automatically).
 * @param params.capacityOf - Optional per-node capacity lookup overriding `viewersPerNode` for leaf seating.
 * @returns The computed {@link CascadePlan}, including any `unmetViewers` shortfall.
 * @throws `InvalidArgumentError` when `fanout < 1` or `viewersPerNode < 1`.
 *
 * @example
 * ```ts
 * const plan = planCascadeTree({
 *   originId: 'origin',
 *   viewerCount: 1_000_000,
 *   fanout: 8,
 *   viewersPerNode: 1000,
 *   availableNodeIds: relayIds,
 * })
 * console.log(plan.tiers, plan.servedViewers, plan.unmetViewers)
 * ```
 */
export function planCascadeTree(params: {
    originId: string
    viewerCount: number
    fanout: number
    viewersPerNode: number
    availableNodeIds: string[]
    capacityOf?: (nodeId: string) => number
}): CascadePlan {
    const { originId, viewerCount, fanout, viewersPerNode, availableNodeIds, capacityOf } = params
    const capFor = (id: string): number =>
        id === originId ? viewersPerNode : (capacityOf?.(id) ?? viewersPerNode)
    if (fanout < 1)
        throw new InvalidArgumentError(`planCascadeTree: fanout must be >= 1 (got ${fanout})`)
    if (viewersPerNode < 1)
        throw new InvalidArgumentError(
            `planCascadeTree: viewersPerNode must be >= 1 (got ${viewersPerNode})`,
        )

    const nodes = new Map<string, CascadePlanNode>()
    const links: CascadeLink[] = []
    const root: CascadePlanNode = {
        id: originId,
        role: 'origin',
        children: [],
        tier: 0,
        viewerSlots: 0,
    }
    nodes.set(originId, root)

    const pool = availableNodeIds.filter((id) => id !== originId)
    let frontier: CascadePlanNode[] = [root]
    let tier = 0

    while (frontier.length * viewersPerNode < viewerCount && pool.length > 0) {
        const next: CascadePlanNode[] = []
        for (const parent of frontier) {
            for (let i = 0; i < fanout && pool.length > 0; i++) {
                const childId = pool.shift() as string
                const child: CascadePlanNode = {
                    id: childId,
                    role: 'edge',
                    parentId: parent.id,
                    children: [],
                    tier: tier + 1,
                    viewerSlots: 0,
                }
                nodes.set(childId, child)
                parent.children.push(childId)
                links.push({ from: parent.id, to: childId })
                next.push(child)
            }
            if (pool.length === 0) break
        }
        if (next.length === 0) break
        for (const p of frontier) if (p.children.length > 0 && p.role !== 'origin') p.role = 'relay'
        frontier = next
        tier++
    }

    const leaves = [...nodes.values()].filter((n) => n.children.length === 0)
    let remaining = viewerCount
    for (const leaf of leaves) {
        if (remaining <= 0) break
        leaf.viewerSlots = Math.min(capFor(leaf.id), remaining)
        remaining -= leaf.viewerSlots
    }

    return {
        origin: originId,
        nodes,
        links,
        edges: leaves.filter((l) => l.viewerSlots > 0).map((l) => l.id),
        tiers: tier + 1,
        servedViewers: viewerCount - remaining,
        unmetViewers: remaining,
    }
}

type CascadeTreeEvents = {
    [CascadeTreeEvent.TreeBuilt]: [roomId: string, plan: CascadePlan]
    [CascadeTreeEvent.LinkCreated]: [roomId: string, from: string, to: string]
    [CascadeTreeEvent.LinkDropped]: [roomId: string, from: string, to: string]
    [CascadeTreeEvent.LeafAssigned]: [roomId: string, nodeId: string, viewerSlots: number]
    [CascadeTreeEvent.TreeDropped]: [roomId: string]
    [CascadeTreeEvent.CapacityShortfall]: [roomId: string, unmetViewers: number]
}

interface RoomTree {
    originId: string
    viewerCount: number
    plan: CascadePlan
}

export const cascadeLinkKey = (from: string, to: string): string => `${from}>${to}`
const linkKey = (l: CascadeLink): string => cascadeLinkKey(l.from, l.to)

/**
 * Builds and maintains per-room cascade fan-out trees over an {@link SfuCluster},
 * scaling a single room's media to a very large viewer population.
 *
 * For each room it runs {@link planCascadeTree} across the cluster's active
 * nodes, then diffs the new plan against the previous one to emit the minimal
 * set of link create/drop events and update per-node room tracking. It watches
 * the cluster through a {@link NodeFailureTracker}: when a node that
 * participates in a room's tree fails or is removed, that room's tree is rebuilt
 * automatically.
 *
 * Emits {@link CascadeTreeEvent} events. Pair with a {@link CascadeBridge} to
 * realize the tree's links as real inter-node media pipes.
 *
 * @example
 * ```ts
 * const tree = new CascadeTree(cluster, { fanout: 8, viewersPerNode: 1000 })
 * tree.on(CascadeTreeEvent.LinkCreated, (roomId, from, to) => {
 *   media.pipeLink(roomId, from, to)
 * })
 *
 * // Scale a broadcast to one million viewers:
 * const plan = tree.build('live-1', 'origin', 1_000_000)
 * if (plan.unmetViewers > 0) addMoreNodes()
 *
 * tree.detach('live-1')
 * ```
 *
 * @remarks
 * Call {@link CascadeTree.dispose} to detach from cluster failure events when
 * the tree is no longer needed.
 */
export class CascadeTree extends EventEmitter<CascadeTreeEvents> {
    private readonly _cluster: SfuCluster
    private readonly _fanout: number
    private readonly _viewersPerNode: number
    private readonly _logger: Logger
    private readonly _rooms = new Map<string, RoomTree>()
    private readonly _failures: NodeFailureTracker

    /**
     * @param cluster - Cluster supplying the active nodes used to build trees, watched for failures.
     * @param options - Fan-out, per-node viewer capacity, and logging configuration.
     */
    constructor(cluster: SfuCluster, options: CascadeTreeOptions = {}) {
        super()
        this._cluster = cluster
        this._fanout = options.fanout ?? 8
        this._viewersPerNode = options.viewersPerNode ?? 1000
        this._logger = options.logger ?? noopLogger
        this._failures = new NodeFailureTracker(cluster, (node) => this._onNodeGone(node.id))
    }

    private _onNodeGone(nodeId: string): void {
        for (const [roomId, room] of [...this._rooms]) {
            if (room.plan.nodes.has(nodeId)) {
                this._logger.warn('Rebuilding cascade tree — node gone', { roomId, nodeId })
                this.build(roomId, room.originId, room.viewerCount)
            }
        }
    }

    /** Detach from cluster failure events. Existing room trees are left intact. */
    dispose(): void {
        this._failures.dispose()
    }

    private _activePool(originId: string): string[] {
        return this._cluster
            .getActiveNodes()
            .filter((n) => n.id !== originId)
            .map((n) => n.id)
    }

    /**
     * Build (or rebuild) the cascade tree for a room and reconcile it against
     * any existing tree.
     *
     * Computes a fresh plan over the cluster's active nodes, emits
     * {@link CascadeTreeEvent.LinkCreated} / {@link CascadeTreeEvent.LinkDropped}
     * for the links that changed, updates per-node room tracking, and emits
     * {@link CascadeTreeEvent.LeafAssigned} for each seated leaf. If the plan
     * cannot seat every viewer it emits {@link CascadeTreeEvent.CapacityShortfall}.
     * Always emits {@link CascadeTreeEvent.TreeBuilt} with the final plan.
     *
     * @param roomId - Identifier of the room the tree serves.
     * @param originId - Identifier of the origin (root) node.
     * @param viewerCount - Total number of viewers to distribute across the tree.
     * @returns The computed {@link CascadePlan}.
     */
    build(roomId: string, originId: string, viewerCount: number): CascadePlan {
        const index = this._nodeIndex()
        const plan = planCascadeTree({
            originId,
            viewerCount,
            fanout: this._fanout,
            viewersPerNode: this._viewersPerNode,
            availableNodeIds: this._activePool(originId),
            capacityOf: (id) => index.get(id)?.capacity ?? this._viewersPerNode,
        })

        const prev = this._rooms.get(roomId)
        this._diff(roomId, prev?.plan, plan)

        const nowIds = new Set(plan.nodes.keys())
        if (prev) {
            for (const id of prev.plan.nodes.keys()) {
                if (!nowIds.has(id)) index.get(id)?.untrackRoom(roomId)
            }
        }
        for (const id of nowIds) index.get(id)?.trackRoom(roomId)

        this._rooms.set(roomId, { originId, viewerCount, plan })

        for (const edgeId of plan.edges) {
            this.emit(
                CascadeTreeEvent.LeafAssigned,
                roomId,
                edgeId,
                plan.nodes.get(edgeId)?.viewerSlots ?? 0,
            )
        }
        if (plan.unmetViewers > 0) {
            this._logger.warn('Cascade capacity shortfall', {
                roomId,
                unmet: plan.unmetViewers,
            })
            this.emit(CascadeTreeEvent.CapacityShortfall, roomId, plan.unmetViewers)
        }
        this.emit(CascadeTreeEvent.TreeBuilt, roomId, plan)
        return plan
    }

    private _diff(roomId: string, oldPlan: CascadePlan | undefined, newPlan: CascadePlan): void {
        const oldLinks = new Set((oldPlan?.links ?? []).map(linkKey))
        const newLinks = new Set(newPlan.links.map(linkKey))
        for (const l of oldPlan?.links ?? []) {
            if (!newLinks.has(linkKey(l)))
                this.emit(CascadeTreeEvent.LinkDropped, roomId, l.from, l.to)
        }
        for (const l of newPlan.links) {
            if (!oldLinks.has(linkKey(l)))
                this.emit(CascadeTreeEvent.LinkCreated, roomId, l.from, l.to)
        }
    }

    private _nodeIndex(): Map<string, SfuNode> {
        return new Map(this._cluster.nodes.map((n) => [n.id, n]))
    }

    /**
     * Tear down a room's cascade tree, untracking every participating node and
     * emitting {@link CascadeTreeEvent.LinkDropped} for each link followed by
     * {@link CascadeTreeEvent.TreeDropped}.
     *
     * @param roomId - Identifier of the room to detach.
     * @returns `true` if the room had a tree, `false` otherwise.
     */
    detach(roomId: string): boolean {
        const room = this._rooms.get(roomId)
        if (!room) return false
        const index = this._nodeIndex()
        for (const id of room.plan.nodes.keys()) index.get(id)?.untrackRoom(roomId)
        for (const l of room.plan.links)
            this.emit(CascadeTreeEvent.LinkDropped, roomId, l.from, l.to)
        this._rooms.delete(roomId)
        this.emit(CascadeTreeEvent.TreeDropped, roomId)
        return true
    }

    /**
     * Get the current cascade plan for a room.
     *
     * @param roomId - Identifier of the room.
     * @returns The room's {@link CascadePlan}, or `undefined` if no tree exists for it.
     */
    getPlan(roomId: string): CascadePlan | undefined {
        return this._rooms.get(roomId)?.plan
    }
}
