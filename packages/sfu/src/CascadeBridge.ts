import { EventEmitter } from 'rtcforge-core'
import { cascadeLinkKey } from './CascadeTree.js'
import type { CascadeTree } from './CascadeTree.js'
import { CascadeTreeEvent } from './types.js'
import type { CascadePipeInterface } from './types.js'

/** Events emitted by a {@link CascadeBridge}. */
export const CascadeBridgeEvent = {
    /** A `pipeLink`/`unpipeLink` on the media plane failed. Payload: `(roomId, from, to, error)`. */
    PipeError: 'pipeError',
} as const

type CascadeBridgeEvents = {
    [CascadeBridgeEvent.PipeError]: [roomId: string, from: string, to: string, err: Error]
}

/**
 * Realizes a {@link CascadeTree}'s planned parent-to-child links as actual media
 * pipes on a concrete media plane.
 *
 * @remarks
 * Subscribes to the tree's `LinkCreated`/`LinkDropped` events and forwards them
 * to a {@link CascadePipeInterface} (for example {@link ReferenceSfuMedia}) as
 * `pipeLink`/`unpipeLink` calls, so the fan-out tree computed by the control
 * plane becomes real inter-node forwarding. The media methods may be async; the
 * bridge awaits them and emits {@link CascadeBridgeEvent.PipeError} on failure
 * (rather than swallowing it), so a broken pipe is visible. Attach it before the
 * first `build()`; existing links are not replayed. Call
 * {@link CascadeBridge.detach} to tear down every pipe it established.
 */
export class CascadeBridge extends EventEmitter<CascadeBridgeEvents> {
    private readonly _tree: CascadeTree
    private readonly _media: CascadePipeInterface
    private _attached = false
    private readonly _links = new Map<string, Map<string, { from: string; to: string }>>()

    constructor(tree: CascadeTree, media: CascadePipeInterface) {
        super()
        this._tree = tree
        this._media = media
    }

    // Await a (possibly-async) media op and surface a failure instead of hiding it.
    private _run(roomId: string, from: string, to: string, fn: () => void | Promise<void>): void {
        try {
            const result = fn()
            if (result instanceof Promise) {
                result.catch((err: unknown) =>
                    this.emit(
                        CascadeBridgeEvent.PipeError,
                        roomId,
                        from,
                        to,
                        err instanceof Error ? err : new Error(String(err)),
                    ),
                )
            }
        } catch (err) {
            this.emit(
                CascadeBridgeEvent.PipeError,
                roomId,
                from,
                to,
                err instanceof Error ? err : new Error(String(err)),
            )
        }
    }

    private readonly _onLinkCreated = (roomId: string, from: string, to: string): void => {
        const links = this._links.get(roomId) ?? new Map<string, { from: string; to: string }>()
        links.set(cascadeLinkKey(from, to), { from, to })
        this._links.set(roomId, links)
        this._run(roomId, from, to, () => this._media.pipeLink(roomId, from, to))
    }

    private readonly _onLinkDropped = (roomId: string, from: string, to: string): void => {
        const links = this._links.get(roomId)
        if (links) {
            links.delete(cascadeLinkKey(from, to))
            if (links.size === 0) this._links.delete(roomId)
        }
        this._run(roomId, from, to, () => this._media.unpipeLink(roomId, from, to))
    }

    private readonly _onTreeDropped = (roomId: string): void => {
        this._links.delete(roomId)
    }

    attach(): void {
        if (this._attached) return
        this._attached = true
        this._tree.on(CascadeTreeEvent.LinkCreated, this._onLinkCreated)
        this._tree.on(CascadeTreeEvent.LinkDropped, this._onLinkDropped)
        this._tree.on(CascadeTreeEvent.TreeDropped, this._onTreeDropped)
    }

    detach(): void {
        if (!this._attached) return
        this._attached = false
        this._tree.off(CascadeTreeEvent.LinkCreated, this._onLinkCreated)
        this._tree.off(CascadeTreeEvent.LinkDropped, this._onLinkDropped)
        this._tree.off(CascadeTreeEvent.TreeDropped, this._onTreeDropped)
        for (const [roomId, links] of this._links) {
            for (const { from, to } of links.values()) {
                this._run(roomId, from, to, () => this._media.unpipeLink(roomId, from, to))
            }
        }
        this._links.clear()
    }
}
