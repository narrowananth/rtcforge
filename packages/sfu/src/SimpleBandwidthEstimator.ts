import type { NetworkStats } from '@rtcforge/core'
import type {
    BandwidthEstimator,
    BandwidthQuality,
    SimpleBandwidthEstimatorOptions,
} from './types.js'

export class SimpleBandwidthEstimator implements BandwidthEstimator {
    private readonly opts: Required<SimpleBandwidthEstimatorOptions>
    private _streak = 0
    private _pendingDir: -1 | 0 | 1 = 0
    private _lastQuality: BandwidthQuality = 'high'

    constructor(opts: SimpleBandwidthEstimatorOptions = {}) {
        this.opts = {
            packetLossHighThreshold: opts.packetLossHighThreshold ?? 0.1,
            packetLossMedThreshold: opts.packetLossMedThreshold ?? 0.03,
            rttHighThreshold: opts.rttHighThreshold ?? 300,
            rttMedThreshold: opts.rttMedThreshold ?? 150,
            bitrateMinKbps: opts.bitrateMinKbps ?? 500,
            downgradeStreak: opts.downgradeStreak ?? 2,
            upgradeStreak: opts.upgradeStreak ?? 3,
        }
    }

    estimate(stats: NetworkStats): BandwidthQuality {
        const {
            packetLossHighThreshold,
            packetLossMedThreshold,
            rttHighThreshold,
            rttMedThreshold,
            bitrateMinKbps,
        } = this.opts
        let raw: BandwidthQuality
        if (stats.packetLoss > packetLossHighThreshold || stats.rtt > rttHighThreshold) {
            raw = 'low'
        } else if (
            stats.packetLoss > packetLossMedThreshold ||
            stats.rtt > rttMedThreshold ||
            stats.bitrate < bitrateMinKbps * 1000
        ) {
            raw = 'medium'
        } else {
            raw = 'high'
        }

        const names: BandwidthQuality[] = ['low', 'medium', 'high']
        const order = { low: 0, medium: 1, high: 2 }
        const committed = order[this._lastQuality]
        const target = order[raw]

        if (target === committed) {
            this._streak = 0
            this._pendingDir = 0
            return this._lastQuality
        }

        const dir: -1 | 1 = target > committed ? 1 : -1
        if (dir !== this._pendingDir) {
            this._pendingDir = dir
            this._streak = 1
        } else {
            this._streak++
        }

        const threshold = dir < 0 ? this.opts.downgradeStreak : this.opts.upgradeStreak
        if (this._streak >= threshold) {
            this._lastQuality = names[committed + dir]
            this._streak = 0
            this._pendingDir = 0
        }
        return this._lastQuality
    }

    reset(): void {
        this._streak = 0
        this._pendingDir = 0
        this._lastQuality = 'high'
    }
}
