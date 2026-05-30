import { EventEmitter } from '@rtcforge/core'
import type { SfuCluster } from './SfuCluster.js'
import type { SfuNode } from './SfuNode.js'
import { CascadingRouterEvent, SfuClusterEvent, SfuNodeEvent, noopLogger } from './types.js'
import type { CascadingRouterOptions, Logger } from './types.js'

type CascadingRouterEvents = {
    [CascadingRouterEvent.RoomAssigned]: [roomId: string, node: SfuNode]
    [CascadingRouterEvent.CascadeCreated]: [roomId: string, fromNode: SfuNode, toNode: SfuNode]
    [CascadingRouterEvent.RoomDetached]: [roomId: string]
    [CascadingRouterEvent.CascadeDropped]: [roomId: string, node: SfuNode]
}

export class CascadingRouter extends EventEmitter<CascadingRouterEvents> {
    private readonly _cluster: SfuCluster
    private readonly _assignments = new Map<string, SfuNode>()
    private readonly _cascadeLinks = new Map<string, SfuNode[]>()
    private readonly _logger: Logger
    private readonly _nodeFailedListeners = new Map<string, () => void>()

    constructor(cluster: SfuCluster, options: CascadingRouterOptions = {}) {
        super()
        this._cluster = cluster
        this._logger = options.logger ?? noopLogger

        for (const node of cluster.nodes) {
            this._attachNodeFailedListener(node)
        }
        cluster.on(SfuClusterEvent.NodeAdded, (node: SfuNode) => {
            this._attachNodeFailedListener(node)
        })
        cluster.on(SfuClusterEvent.NodeRemoved, (node: SfuNode) => {
            const listener = this._nodeFailedListeners.get(node.id)
            if (listener) {
                node.off(SfuNodeEvent.Failed, listener)
                this._nodeFailedListeners.delete(node.id)
            }
        })
    }

    private _attachNodeFailedListener(node: SfuNode): void {
        if (this._nodeFailedListeners.has(node.id)) return
        const listener = () => {
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
        this._nodeFailedListeners.set(node.id, listener)
        node.on(SfuNodeEvent.Failed, listener)
    }

    get assignmentCount(): number {
        return this._assignments.size
    }

    attachRoom(roomId: string, preferredRegion?: string): SfuNode {
        const node = this._cluster.assignNode(preferredRegion)
        if (!node) throw new Error('No available SFU node in cluster')

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

    getAssignment(roomId: string): SfuNode | undefined {
        return this._assignments.get(roomId)
    }

    getCascadeNodes(roomId: string): SfuNode[] {
        return this._cascadeLinks.get(roomId) ?? []
    }
}
