import { cascadeLinkKey } from './CascadeTree.js'
import type { CascadeTree } from './CascadeTree.js'
import { CascadeTreeEvent } from './types.js'
import type { CascadePipeInterface } from './types.js'

export class CascadeBridge {
    private readonly _tree: CascadeTree
    private readonly _media: CascadePipeInterface
    private _attached = false
    private readonly _links = new Map<string, Map<string, { from: string; to: string }>>()

    constructor(tree: CascadeTree, media: CascadePipeInterface) {
        this._tree = tree
        this._media = media
    }

    private readonly _onLinkCreated = (roomId: string, from: string, to: string): void => {
        const links = this._links.get(roomId) ?? new Map<string, { from: string; to: string }>()
        links.set(cascadeLinkKey(from, to), { from, to })
        this._links.set(roomId, links)
        this._media.pipeLink(roomId, from, to)
    }

    private readonly _onLinkDropped = (roomId: string, from: string, to: string): void => {
        const links = this._links.get(roomId)
        if (links) {
            links.delete(cascadeLinkKey(from, to))
            if (links.size === 0) this._links.delete(roomId)
        }
        try {
            this._media.unpipeLink(roomId, from, to)
        } catch {}
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
                try {
                    this._media.unpipeLink(roomId, from, to)
                } catch {}
            }
        }
        this._links.clear()
    }
}
