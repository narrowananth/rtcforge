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

export class SfuNode extends EventEmitter<SfuNodeEvents> {
    readonly id: string
    readonly region: string
    readonly capacity: number
    private _load = 0
    private _failed = false
    private _draining = false
    private readonly _logger: Logger
    private _statsCollector: StatsCollector | null = null
    private readonly _rooms = new Set<string>()
    private readonly _drainResolvers = new Set<() => void>()

    constructor(id: string, region: string, options: SfuNodeOptions = {}) {
        super()
        this.id = id
        this.region = region
        this.capacity = options.capacity ?? DEFAULT_CAPACITY
        this._logger = options.logger ?? noopLogger
    }

    get load(): number {
        return this._load
    }

    get isFailed(): boolean {
        return this._failed
    }

    get isDraining(): boolean {
        return this._draining
    }

    get isOverloaded(): boolean {
        return this._load >= this.capacity
    }

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

    markRecovered(): void {
        if (!this._failed) return
        this._failed = false
        this._logger.info('Node recovered', { id: this.id })
        this.emit(SfuNodeEvent.Recovered)
    }

    trackRoom(roomId: string): void {
        this._rooms.add(roomId)
    }

    untrackRoom(roomId: string): void {
        this._rooms.delete(roomId)
        if (this._draining && this._rooms.size === 0) {
            for (const resolve of this._drainResolvers) resolve()
            this._drainResolvers.clear()
        }
    }

    get roomCount(): number {
        return this._rooms.size
    }

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
        )
        this._statsCollector.start()
    }

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
