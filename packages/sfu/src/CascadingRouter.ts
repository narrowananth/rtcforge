import { EventEmitter } from 'rtcforge-core'
import { NodeFailureTracker } from './NodeFailureTracker.js'
import type { SfuCluster } from './SfuCluster.js'
import type { SfuNode } from './SfuNode.js'
import { NoAvailableNodeError } from './errors.js'
import { CascadingRouterEvent, noopLogger } from './types.js'
import type { CascadingRouterOptions, Logger } from './types.js'

type CascadingRouterEvents = {
    [CascadingRouterEvent.RoomAssigned]: [roomId: string, node: SfuNode]
    [CascadingRouterEvent.CascadeCreated]: [roomId: string, fromNode: SfuNode, toNode: SfuNode]
    [CascadingRouterEvent.RoomDetached]: [roomId: string]
    [CascadingRouterEvent.CascadeDropped]: [roomId: string, node: SfuNode]
}

/**
 * Assigns rooms to SFU nodes and grows per-room cascades across additional
 * nodes on top of an {@link SfuCluster}.
 *
 * Each room gets one primary node via the cluster's placement strategy. When a
 * room is attached again and placement resolves to a different node, that node
 * is added as a cascade link — letting a single room span multiple SFUs (for
 * example across regions). The router watches the cluster through a
 * {@link NodeFailureTracker}: when a node fails or is removed, its room
 * assignments are cleared and its cascade links dropped, emitting the
 * corresponding detach and drop events.
 *
 * Emits {@link CascadingRouterEvent} events. Pair with an {@link SfuBridge} to
 * apply these decisions onto a concrete media plane.
 *
 * @example
 * ```ts
 * const router = new CascadingRouter(cluster)
 * router.on(CascadingRouterEvent.RoomAssigned, (roomId, node) => {
 *   console.log(`${roomId} -> ${node.id}`)
 * })
 *
 * const primary = router.attachRoom('room-1', 'us-east')
 * // A second attach that resolves elsewhere creates a cascade link:
 * router.attachRoom('room-1', 'eu-west')
 *
 * router.detachRoom('room-1')
 * ```
 *
 * @remarks
 * Call {@link CascadingRouter.dispose} to detach from cluster events when the
 * router is no longer needed.
 */
export class CascadingRouter extends EventEmitter<CascadingRouterEvents> {
    private readonly _cluster: SfuCluster
    private readonly _assignments = new Map<string, SfuNode>()
    private readonly _cascadeLinks = new Map<string, SfuNode[]>()
    private readonly _logger: Logger
    private readonly _failures: NodeFailureTracker

    /**
     * @param cluster - Cluster whose nodes are assigned to rooms and watched for failures.
     * @param options - Optional logging configuration.
     */
    constructor(cluster: SfuCluster, options: CascadingRouterOptions = {}) {
        super()
        this._cluster = cluster
        this._logger = options.logger ?? noopLogger
        this._failures = new NodeFailureTracker(cluster, (node) => this._handleNodeGone(node))
    }

    private _handleNodeGone(node: SfuNode): void {
        for (const [roomId, assigned] of [...this._assignments]) {
            if (assigned.id === node.id) {
                node.untrackRoom(roomId)
                this._assignments.delete(roomId)
                this._logger.warn('Room assignment cleared — node failed', {
                    roomId,
                    nodeId: node.id,
                })
                this.emit(CascadingRouterEvent.RoomDetached, roomId)
            }
        }
        for (const [roomId, nodes] of [...this._cascadeLinks]) {
            const filtered = nodes.filter((n) => n.id !== node.id)
            if (filtered.length !== nodes.length) {
                node.untrackRoom(roomId)
                this.emit(CascadingRouterEvent.CascadeDropped, roomId, node)
                if (filtered.length === 0) {
                    this._cascadeLinks.delete(roomId)
                } else {
                    this._cascadeLinks.set(roomId, filtered)
                }
            }
        }
    }

    /** Detach from cluster failure events. Existing assignments are left intact. */
    dispose(): void {
        this._failures.dispose()
    }

    /** Number of rooms with a primary node assignment. */
    get assignmentCount(): number {
        return this._assignments.size
    }

    /**
     * Attach a room to an SFU node, or extend it with a cascade link.
     *
     * On first attach the room is assigned a primary node and
     * {@link CascadingRouterEvent.RoomAssigned} is emitted. On subsequent attaches
     * that resolve to a different node, that node is added as a cascade link and
     * {@link CascadingRouterEvent.CascadeCreated} is emitted (once per distinct
     * node). Attaches that resolve to an already-linked node are no-ops.
     *
     * @param roomId - Identifier of the room to attach.
     * @param preferredRegion - Optional region hint passed to the placement strategy.
     * @returns The node selected for this attach (primary on first call, cascade target otherwise).
     * @throws {@link NoAvailableNodeError} when the cluster has no active node to assign.
     */
    attachRoom(roomId: string, preferredRegion?: string): SfuNode {
        const node = this._cluster.assignNode(preferredRegion, roomId)
        if (!node) throw new NoAvailableNodeError()

        const existing = this._assignments.get(roomId)
        if (existing) {
            if (existing.id !== node.id) {
                const links = this._cascadeLinks.get(roomId) ?? []
                if (!links.some((n) => n.id === node.id)) {
                    links.push(node)
                    this._cascadeLinks.set(roomId, links)
                    node.trackRoom(roomId)
                    this._logger.info('Cascade link created', {
                        roomId,
                        from: existing.id,
                        to: node.id,
                    })
                    this.emit(CascadingRouterEvent.CascadeCreated, roomId, existing, node)
                }
            }
            return node
        }

        this._assignments.set(roomId, node)
        node.trackRoom(roomId)
        this._logger.info('Room assigned to SFU node', {
            roomId,
            nodeId: node.id,
            region: node.region,
        })
        this.emit(CascadingRouterEvent.RoomAssigned, roomId, node)
        return node
    }

    /**
     * Detach a room from the SFU entirely, releasing its primary node and every
     * cascade link. Emits {@link CascadingRouterEvent.RoomDetached}.
     *
     * @param roomId - Identifier of the room to detach.
     * @returns `true` if the room was attached, `false` otherwise.
     */
    detachRoom(roomId: string): boolean {
        const primary = this._assignments.get(roomId)
        if (!primary) return false
        primary.untrackRoom(roomId)
        this._assignments.delete(roomId)
        const cascades = this._cascadeLinks.get(roomId) ?? []
        for (const n of cascades) n.untrackRoom(roomId)
        this._cascadeLinks.delete(roomId)
        this._logger.info('Room detached from SFU', { roomId })
        this.emit(CascadingRouterEvent.RoomDetached, roomId)
        return true
    }

    /**
     * Get the primary node currently assigned to a room.
     *
     * @param roomId - Identifier of the room.
     * @returns The primary node, or `undefined` if the room is not attached.
     */
    getAssignment(roomId: string): SfuNode | undefined {
        return this._assignments.get(roomId)
    }

    /**
     * Get the cascade nodes (beyond the primary) currently serving a room.
     *
     * @param roomId - Identifier of the room.
     * @returns A copy of the room's cascade node list (empty if none).
     */
    getCascadeNodes(roomId: string): SfuNode[] {
        return [...(this._cascadeLinks.get(roomId) ?? [])]
    }
}
