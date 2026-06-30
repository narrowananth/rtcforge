import type { NetworkStats } from 'rtcforge-core'
import type { BandwidthEstimator, BandwidthQuality } from './types.js'

export class StatsCollector {
    private _timer: ReturnType<typeof setInterval> | null = null
    private _collecting = false

    constructor(
        private readonly estimator: BandwidthEstimator,
        private readonly getStats: () => Promise<NetworkStats>,
        private readonly onQuality: (quality: BandwidthQuality) => void,
        private readonly intervalMs = 5000,
    ) {}

    start(): void {
        this.stop()
        this._timer = setInterval(() => void this._collect(), this.intervalMs)
        this._timer.unref?.()
    }

    stop(): void {
        if (this._timer !== null) {
            clearInterval(this._timer)
            this._timer = null
        }
    }

    private async _collect(): Promise<void> {
        if (this._collecting) return
        this._collecting = true
        try {
            const stats = await this.getStats()
            this.onQuality(this.estimator.estimate(stats))
        } catch {
        } finally {
            this._collecting = false
        }
    }
}
