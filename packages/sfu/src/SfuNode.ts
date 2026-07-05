import { EventEmitter } from 'rtcforge-core'
import type { NetworkStats } from 'rtcforge-core'
import { StatsCollector } from './StatsCollector.js'
import { SfuNodeEvent, noopLogger } from './types.js'
import type { BandwidthEstimator, BandwidthQuality, Logger, SfuNodeOptions } from './types.js'

const DEFAULT_CAPACITY = 100

type SfuNodeEvents = {
    [SfuNodeEvent.Load]: [load: number]
    [SfuNodeEvent.Overloaded]: []
    [SfuNodeEvent.Failed]: []
    [SfuNodeEvent.Recovered]: []
    [SfuNodeEvent.Draining]: []
    [SfuNodeEvent.Drained]: []
    [SfuNodeEvent.BandwidthEstimate]: [quality: BandwidthQuality]
}

/**
 * A single SFU (Selective Forwarding Unit) instance within a cluster.
 *
 * Tracks the node's identity, region, capacity, live load, and lifecycle state
 * (failed, draining), and can run a background stats collector that emits
 * {@link BandwidthQuality} estimates. Consumed by {@link SfuCluster},
 * {@link CascadingRouter}, and {@link CascadeTree} to make placement and
 * fan-out decisions.
 *
 * Emits {@link SfuNodeEvent} events.
 */
export class SfuNode extends EventEmitter<SfuNodeEvents> {
    /** Stable unique identifier for this node. */
    readonly id: string
    /** Region the node resides in; used for region-affinity placement. */
    readonly region: string
    /** Maximum load the node can carry before it is considered overloaded. */
    readonly capacity: number
    private _load = 0
    private _failed = false
    private _draining = false
    private readonly _logger: Logger
    private _statsCollector: StatsCollector | null = null
    private readonly _rooms = new Set<string>()
    private readonly _drainResolvers = new Set<() => void>()

    /**
     * @param id - Stable unique identifier for the node.
     * @param region - Region the node resides in.
     * @param options - Optional capacity and logger overrides.
     */
    constructor(id: string, region: string, options: SfuNodeOptions = {}) {
        super()
        this.id = id
        this.region = region
        this.capacity = options.capacity ?? DEFAULT_CAPACITY
        this._logger = options.logger ?? noopLogger
    }

    /** Most recently reported load value. */
    get load(): number {
        return this._load
    }

    /** Whether the node is currently marked failed. */
    get isFailed(): boolean {
        return this._failed
    }

    /** Whether the node is currently draining its rooms. */
    get isDraining(): boolean {
        return this._draining
    }

    /** Whether reported load has reached or exceeded {@link SfuNode.capacity}. */
    get isOverloaded(): boolean {
        return this._load >= this.capacity
    }

    /**
     * Report the node's current load.
     *
     * Emits {@link SfuNodeEvent.Load} on every call, and additionally emits
     * {@link SfuNodeEvent.Overloaded} the first time load crosses into the
     * overloaded range.
     *
     * @param n - The current load value.
     */
    reportLoad(n: number): void {
        const wasOverloaded = this.isOverloaded
        this._load = n
        this._logger.debug('Load reported', { id: this.id, load: n })
        this.emit(SfuNodeEvent.Load, n)
        if (!wasOverloaded && this.isOverloaded) {
            this._logger.warn('Node overloaded', { id: this.id, load: n, capacity: this.capacity })
            this.emit(SfuNodeEvent.Overloaded)
        }
    }

    /**
     * Mark the node as failed.
     *
     * Stops any running stats collection, resolves a pending drain if one is in
     * progress, and emits {@link SfuNodeEvent.Failed}. Idempotent — a no-op if
     * the node is already failed.
     */
    markFailed(): void {
        if (this._failed) return
        this._failed = true
        this.stopStatsCollection()
        if (this._draining) {
            for (const cleanup of this._drainResolvers) cleanup()
            this._drainResolvers.clear()
        }
        this._logger.error('Node failed', { id: this.id })
        this.emit(SfuNodeEvent.Failed)
    }

    /**
     * Clear the failed state of a previously failed node.
     *
     * Emits {@link SfuNodeEvent.Recovered}. Idempotent — a no-op if the node is
     * not currently failed.
     */
    markRecovered(): void {
        if (!this._failed) return
        this._failed = false
        this._logger.info('Node recovered', { id: this.id })
        this.emit(SfuNodeEvent.Recovered)
    }

    /**
     * Record that `roomId` is being served by this node.
     *
     * @param roomId - The room to track.
     */
    trackRoom(roomId: string): void {
        this._rooms.add(roomId)
    }

    /**
     * Stop tracking `roomId` on this node.
     *
     * If the node is draining and this was its last room, any pending drain
     * resolves.
     *
     * @param roomId - The room to untrack.
     */
    untrackRoom(roomId: string): void {
        this._rooms.delete(roomId)
        if (this._draining && this._rooms.size === 0) {
            for (const resolve of this._drainResolvers) resolve()
            this._drainResolvers.clear()
        }
    }

    /** Number of rooms currently tracked on this node. */
    get roomCount(): number {
        return this._rooms.size
    }

    /**
     * Gracefully drain the node.
     *
     * Marks the node draining (so placement stops selecting it), stops stats
     * collection, and emits {@link SfuNodeEvent.Draining}. Resolves once all
     * tracked rooms have been untracked, or once `timeoutMs` elapses — whichever
     * comes first — after which it clears the draining flag and emits
     * {@link SfuNodeEvent.Drained}. Concurrent calls after the first are no-ops.
     *
     * @param timeoutMs - Maximum time to wait for rooms to drain before forcing completion.
     * @defaultValue 30000
     */
    async drain(timeoutMs = 30_000): Promise<void> {
        if (this._draining) return
        this._draining = true
        this.stopStatsCollection()
        this._logger.info('Node draining', { id: this.id })
        this.emit(SfuNodeEvent.Draining)

        await new Promise<void>((resolve) => {
            if (this._rooms.size === 0) {
                resolve()
                return
            }
            const cleanup = () => {
                clearTimeout(timeoutId)
                this._drainResolvers.delete(cleanup)
                resolve()
            }
            const timeoutId = setTimeout(() => {
                this._drainResolvers.delete(cleanup)
                this._logger.warn('Drain timeout, forcing Drained', {
                    id: this.id,
                    remainingRooms: this._rooms.size,
                })
                resolve()
            }, timeoutMs)
            this._drainResolvers.add(cleanup)
        })

        this._draining = false
        this.emit(SfuNodeEvent.Drained)
    }

    /**
     * Begin periodically sampling network statistics and emitting bandwidth
     * quality estimates.
     *
     * Any previously running collector is stopped first. On each interval the
     * collector calls `getStats`, feeds the sample to `estimator`, and emits
     * {@link SfuNodeEvent.BandwidthEstimate} with the resulting quality tier.
     *
     * @param estimator - Estimator that maps a stats sample to a {@link BandwidthQuality}.
     * @param getStats - Async provider of the latest network statistics sample.
     * @param intervalMs - Sampling interval in milliseconds.
     * @defaultValue 5000
     */
    startStatsCollection(
        estimator: BandwidthEstimator,
        getStats: () => Promise<NetworkStats>,
        intervalMs = 5000,
    ): void {
        this.stopStatsCollection()
        this._statsCollector = new StatsCollector(
            estimator,
            getStats,
            (quality) => this._reportBandwidthQuality(quality),
            intervalMs,
            this._logger,
        )
        this._statsCollector.start()
    }

    /** Stop the background stats collector if one is running. */
    stopStatsCollection(): void {
        if (this._statsCollector !== null) {
            this._statsCollector.stop()
            this._statsCollector = null
        }
    }

    private _reportBandwidthQuality(quality: BandwidthQuality): void {
        this.emit(SfuNodeEvent.BandwidthEstimate, quality)
    }
}
