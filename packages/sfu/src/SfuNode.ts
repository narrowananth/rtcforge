import { EventEmitter } from '@rtcforge/core'
import { SfuNodeEvent, noopLogger } from './types.js'
import type { BandwidthEstimator, Logger, SfuNodeOptions } from './types.js'

const DEFAULT_CAPACITY = 100

type SfuNodeEvents = {
    [SfuNodeEvent.Load]: [load: number]
    [SfuNodeEvent.Overloaded]: []
    [SfuNodeEvent.Failed]: []
    [SfuNodeEvent.Recovered]: []
    [SfuNodeEvent.Draining]: []
    [SfuNodeEvent.Drained]: []
    [SfuNodeEvent.BandwidthEstimate]: [quality: 'high' | 'medium' | 'low']
}

type StatsCollection = {
    timer: ReturnType<typeof setInterval>
    estimator: BandwidthEstimator
    getStats: () => Promise<{ bitrate: number; packetLoss: number; rtt: number }>
}

/**
 * Logical SFU node abstraction. Tracks load, lifecycle, and bandwidth estimation.
 * Does NOT implement a WebRTC media server.
 *
 * Integrate a real SFU (mediasoup, Janus, LiveKit) by:
 * 1. Implementing `SfuMediaInterface`.
 * 2. Creating a `SfuBridge` to connect `CascadingRouter` to your media plane.
 * 3. Reporting real load via `reportLoad()` and calling `markFailed()` on node crash.
 */
export class SfuNode extends EventEmitter<SfuNodeEvents> {
    readonly id: string
    readonly region: string
    readonly capacity: number
    private _load = 0
    private _failed = false
    private _draining = false
    private readonly _logger: Logger
    private _statsCollection: StatsCollection | null = null
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

    reportBandwidthQuality(quality: 'high' | 'medium' | 'low'): void {
        this.emit(SfuNodeEvent.BandwidthEstimate, quality)
    }

    startStatsCollection(
        estimator: BandwidthEstimator,
        getStats: () => Promise<{ bitrate: number; packetLoss: number; rtt: number }>,
        intervalMs = 5000,
    ): void {
        this.stopStatsCollection()
        const timer = setInterval(() => {
            void this._collectStats()
        }, intervalMs)
        timer.unref()
        this._statsCollection = { timer, estimator, getStats }
    }

    stopStatsCollection(): void {
        if (this._statsCollection !== null) {
            clearInterval(this._statsCollection.timer)
            this._statsCollection = null
        }
    }

    private async _collectStats(): Promise<void> {
        if (!this._statsCollection) return
        try {
            const stats = await this._statsCollection.getStats()
            const quality = this._statsCollection.estimator.estimate(stats)
            this.reportBandwidthQuality(quality)
        } catch {
            // ignore transient stats fetch errors
        }
    }
}
