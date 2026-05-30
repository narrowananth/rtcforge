import type { CascadingRouter } from './CascadingRouter.js'
import type { SfuNode } from './SfuNode.js'
import { CascadingRouterEvent } from './types.js'
import type { SfuMediaInterface } from './types.js'

export type { SfuMediaInterface }

/**
 * SfuBridge wires a CascadingRouter to a MediaService so that
 * SFU routing decisions automatically propagate to the media plane.
 */
export class SfuBridge {
    private readonly _router: CascadingRouter
    private readonly _media: SfuMediaInterface
    private _attached = false
    private readonly _assignedRooms = new Set<string>()
    private readonly _cascadeRoutes = new Map<string, Set<string>>()

    private readonly _onRoomAssigned = (roomId: string, node: SfuNode): void => {
        this._assignedRooms.add(roomId)
        this._media.addRoute(roomId, node.id)
    }

    private readonly _onCascadeCreated = (
        roomId: string,
        _fromNode: SfuNode,
        toNode: SfuNode,
    ): void => {
        const nodeSet = this._cascadeRoutes.get(roomId) ?? new Set<string>()
        nodeSet.add(toNode.id)
        this._cascadeRoutes.set(roomId, nodeSet)
        this._media.addRoute(roomId, toNode.id)
    }

    private readonly _onRoomDetached = (roomId: string): void => {
        this._assignedRooms.delete(roomId)
        this._cascadeRoutes.delete(roomId)
        this._media.removeRoute(roomId)
    }

    private readonly _onCascadeDropped = (roomId: string, node: SfuNode): void => {
        const nodeSet = this._cascadeRoutes.get(roomId)
        if (nodeSet) {
            nodeSet.delete(node.id)
            if (nodeSet.size === 0) this._cascadeRoutes.delete(roomId)
        }
        this._media.removeCascadeRoute(roomId, node.id)
    }

    constructor(router: CascadingRouter, media: SfuMediaInterface) {
        this._router = router
        this._media = media
    }

    attach(): void {
        if (this._attached) return
        this._attached = true
        this._router.on(CascadingRouterEvent.RoomAssigned, this._onRoomAssigned)
        this._router.on(CascadingRouterEvent.CascadeCreated, this._onCascadeCreated)
        this._router.on(CascadingRouterEvent.RoomDetached, this._onRoomDetached)
        this._router.on(CascadingRouterEvent.CascadeDropped, this._onCascadeDropped)
    }

    detach(): void {
        if (!this._attached) return
        this._attached = false
        this._router.off(CascadingRouterEvent.RoomAssigned, this._onRoomAssigned)
        this._router.off(CascadingRouterEvent.CascadeCreated, this._onCascadeCreated)
        this._router.off(CascadingRouterEvent.RoomDetached, this._onRoomDetached)
        this._router.off(CascadingRouterEvent.CascadeDropped, this._onCascadeDropped)
        for (const roomId of this._assignedRooms) {
            this._media.removeRoute(roomId)
        }
        for (const [roomId, nodeIds] of this._cascadeRoutes) {
            for (const nodeId of nodeIds) {
                this._media.removeCascadeRoute(roomId, nodeId)
            }
        }
        this._assignedRooms.clear()
        this._cascadeRoutes.clear()
    }
}
