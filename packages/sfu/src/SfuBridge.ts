import { EventEmitter } from 'rtcforge-core'
import type { CascadingRouter } from './CascadingRouter.js'
import type { SfuNode } from './SfuNode.js'
import { CascadingRouterEvent } from './types.js'
import type { SfuMediaInterface } from './types.js'

export type { SfuMediaInterface }

/** Events emitted by an {@link SfuBridge}. */
export const SfuBridgeEvent = {
    /** An `addRoute`/`removeRoute`/`removeCascadeRoute` on the media plane failed. Payload: `(roomId, err)`. */
    RouteError: 'routeError',
} as const

type SfuBridgeEvents = {
    [SfuBridgeEvent.RouteError]: [roomId: string, err: Error]
}

/**
 * Connects a {@link CascadingRouter} to a concrete media plane.
 *
 * While attached, the bridge translates the router's room-assignment and
 * cascade events into calls on an {@link SfuMediaInterface}: primary and cascade
 * assignments become `addRoute` calls, detaches become `removeRoute`, and
 * dropped cascades become `removeCascadeRoute`. Those media methods may be async;
 * the bridge awaits them and emits {@link SfuBridgeEvent.RouteError} on failure
 * instead of swallowing it. Detaching removes every route the bridge added so the
 * media plane is left clean.
 */
export class SfuBridge extends EventEmitter<SfuBridgeEvents> {
    private readonly _router: CascadingRouter
    private readonly _media: SfuMediaInterface
    private _attached = false
    private readonly _assignedRooms = new Set<string>()
    private readonly _cascadeRoutes = new Map<string, Set<string>>()

    // Await a (possibly-async) media op and surface a failure instead of hiding it.
    private _run(roomId: string, fn: () => void | Promise<void>): void {
        try {
            const result = fn()
            if (result instanceof Promise) {
                result.catch((err: unknown) =>
                    this.emit(
                        SfuBridgeEvent.RouteError,
                        roomId,
                        err instanceof Error ? err : new Error(String(err)),
                    ),
                )
            }
        } catch (err) {
            this.emit(
                SfuBridgeEvent.RouteError,
                roomId,
                err instanceof Error ? err : new Error(String(err)),
            )
        }
    }

    private readonly _onRoomAssigned = (roomId: string, node: SfuNode): void => {
        this._assignedRooms.add(roomId)
        this._run(roomId, () => this._media.addRoute(roomId, node.id))
    }

    private readonly _onCascadeCreated = (
        roomId: string,
        _fromNode: SfuNode,
        toNode: SfuNode,
    ): void => {
        const nodeSet = this._cascadeRoutes.get(roomId) ?? new Set<string>()
        nodeSet.add(toNode.id)
        this._cascadeRoutes.set(roomId, nodeSet)
        this._run(roomId, () => this._media.addRoute(roomId, toNode.id))
    }

    private readonly _onRoomDetached = (roomId: string): void => {
        this._assignedRooms.delete(roomId)
        this._cascadeRoutes.delete(roomId)
        this._run(roomId, () => this._media.removeRoute(roomId))
    }

    private readonly _onCascadeDropped = (roomId: string, node: SfuNode): void => {
        const nodeSet = this._cascadeRoutes.get(roomId)
        if (nodeSet) {
            nodeSet.delete(node.id)
            if (nodeSet.size === 0) this._cascadeRoutes.delete(roomId)
        }
        this._run(roomId, () => this._media.removeCascadeRoute(roomId, node.id))
    }

    constructor(router: CascadingRouter, media: SfuMediaInterface) {
        super()
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
            this._run(roomId, () => this._media.removeRoute(roomId))
        }
        // removeRoute removes ALL routes for a room, so only issue per-node
        // removeCascadeRoute for rooms with no primary (not covered above) —
        // otherwise it's a redundant call that can spuriously reject/emit.
        for (const [roomId, nodeIds] of this._cascadeRoutes) {
            if (this._assignedRooms.has(roomId)) continue
            for (const nodeId of nodeIds) {
                this._run(roomId, () => this._media.removeCascadeRoute(roomId, nodeId))
            }
        }
        this._assignedRooms.clear()
        this._cascadeRoutes.clear()
    }
}
