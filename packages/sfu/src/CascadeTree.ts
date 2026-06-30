import { EventEmitter, InvalidArgumentError } from 'rtcforge-core'
import { NodeFailureTracker } from './NodeFailureTracker.js'
import type { SfuCluster } from './SfuCluster.js'
import type { SfuNode } from './SfuNode.js'
import { CascadeTreeEvent, noopLogger } from './types.js'
import type { CascadeTreeOptions, Logger } from './types.js'

export type CascadeRole = 'origin' | 'relay' | 'edge'

export interface CascadePlanNode {
    id: string
    role: CascadeRole
    parentId?: string
    children: string[]
    tier: number
    viewerSlots: number
}

export interface CascadeLink {
    from: string
    to: string
}

export interface CascadePlan {
    origin: string
    nodes: Map<string, CascadePlanNode>
    links: CascadeLink[]
    edges: string[]
    tiers: number
    servedViewers: number
    unmetViewers: number
}

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

export class CascadeTree extends EventEmitter<CascadeTreeEvents> {
    private readonly _cluster: SfuCluster
    private readonly _fanout: number
    private readonly _viewersPerNode: number
    private readonly _logger: Logger
    private readonly _rooms = new Map<string, RoomTree>()
    private readonly _failures: NodeFailureTracker

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

    dispose(): void {
        this._failures.dispose()
    }

    private _activePool(originId: string): string[] {
        return this._cluster
            .getActiveNodes()
            .filter((n) => n.id !== originId)
            .map((n) => n.id)
    }

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

    getPlan(roomId: string): CascadePlan | undefined {
        return this._rooms.get(roomId)?.plan
    }
}
