import { noopLogger } from './types.js'
import type { CascadePipeInterface, Logger, SfuMediaInterface } from './types.js'

/**
 * Async hooks that realize routing/piping decisions on a concrete media plane
 * (for example mediasoup pipe transports between two `rtcforge-media` nodes).
 * Every hook is optional and may be async; {@link ReferenceSfuMedia} invokes them
 * fire-and-forget because {@link SfuMediaInterface}/{@link CascadePipeInterface}
 * are synchronous, and reports rejections through the logger.
 */
export interface SfuMediaDriver {
    onAddRoute?(roomId: string, nodeId: string): void | Promise<void>
    onRemoveRoute?(roomId: string, nodeIds: string[]): void | Promise<void>
    onRemoveCascadeRoute?(roomId: string, nodeId: string): void | Promise<void>
    onPipeLink?(roomId: string, fromNodeId: string, toNodeId: string): void | Promise<void>
    onUnpipeLink?(roomId: string, fromNodeId: string, toNodeId: string): void | Promise<void>
}

const linkKey = (from: string, to: string): string => `${from}>${to}`

/**
 * Reference implementation of {@link SfuMediaInterface} and
 * {@link CascadePipeInterface}. It owns the correct in-memory bookkeeping of a
 * room's routes and cascade links (so `getRoutes` and idempotent add/remove work
 * out of the box) and delegates the actual media forwarding to an injected
 * {@link SfuMediaDriver}. This is the missing keystone between `rtcforge-sfu`
 * (control plane) and a real media plane, without coupling the two packages.
 *
 * @example
 * ```ts
 * const media = new ReferenceSfuMedia({
 *   onPipeLink: (roomId, from, to) => pipeBetweenNodes(roomId, from, to), // your mediasoup pipe
 *   onUnpipeLink: (roomId, from, to) => unpipeBetweenNodes(roomId, from, to),
 * })
 * const bridge = new SfuBridge(router, media)
 * const cascade = new CascadeBridge(tree, media)
 * ```
 */
export class ReferenceSfuMedia implements SfuMediaInterface, CascadePipeInterface {
    private readonly _routes = new Map<string, Set<string>>()
    private readonly _links = new Map<string, Set<string>>()
    private readonly _driver: SfuMediaDriver
    private readonly _logger: Logger

    constructor(driver: SfuMediaDriver = {}, logger: Logger = noopLogger) {
        this._driver = driver
        this._logger = logger
    }

    addRoute(roomId: string, nodeId: string): void {
        const set = this._routes.get(roomId) ?? new Set<string>()
        if (set.has(nodeId)) return
        set.add(nodeId)
        this._routes.set(roomId, set)
        this._run('onAddRoute', () => this._driver.onAddRoute?.(roomId, nodeId))
    }

    removeRoute(roomId: string): void {
        const set = this._routes.get(roomId)
        if (!set) return
        const nodeIds = [...set]
        this._routes.delete(roomId)
        this._run('onRemoveRoute', () => this._driver.onRemoveRoute?.(roomId, nodeIds))
    }

    getRoutes(roomId: string): string[] {
        return [...(this._routes.get(roomId) ?? [])]
    }

    removeCascadeRoute(roomId: string, nodeId: string): void {
        const set = this._routes.get(roomId)
        if (!set?.delete(nodeId)) return
        if (set.size === 0) this._routes.delete(roomId)
        this._run('onRemoveCascadeRoute', () => this._driver.onRemoveCascadeRoute?.(roomId, nodeId))
    }

    pipeLink(roomId: string, fromNodeId: string, toNodeId: string): void {
        const set = this._links.get(roomId) ?? new Set<string>()
        const key = linkKey(fromNodeId, toNodeId)
        if (set.has(key)) return
        set.add(key)
        this._links.set(roomId, set)
        this._run('onPipeLink', () => this._driver.onPipeLink?.(roomId, fromNodeId, toNodeId))
    }

    unpipeLink(roomId: string, fromNodeId: string, toNodeId: string): void {
        const set = this._links.get(roomId)
        const key = linkKey(fromNodeId, toNodeId)
        if (!set?.delete(key)) return
        if (set.size === 0) this._links.delete(roomId)
        this._run('onUnpipeLink', () => this._driver.onUnpipeLink?.(roomId, fromNodeId, toNodeId))
    }

    /** Snapshot of the cascade links currently tracked for a room (`from>to` keys). */
    getLinks(roomId: string): string[] {
        return [...(this._links.get(roomId) ?? [])]
    }

    private _run(hook: string, fn: () => void | Promise<void>): void {
        try {
            const result = fn()
            if (result instanceof Promise) {
                result.catch((err: unknown) =>
                    this._logger.error('SfuMediaDriver hook failed', {
                        hook,
                        err: err instanceof Error ? err.message : String(err),
                    }),
                )
            }
        } catch (err) {
            this._logger.error('SfuMediaDriver hook threw', {
                hook,
                err: err instanceof Error ? err.message : String(err),
            })
        }
    }
}
