import type { BandwidthEstimator, SimpleBandwidthEstimatorOptions } from './types.js'

export class SimpleBandwidthEstimator implements BandwidthEstimator {
    private readonly opts: Required<SimpleBandwidthEstimatorOptions>
    private _streak = 0
    private _lastQuality: 'high' | 'medium' | 'low' = 'high'
    private _lastRaw: 'high' | 'medium' | 'low' = 'high'

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

    estimate(stats: { bitrate: number; packetLoss: number; rtt: number }):
        | 'high'
        | 'medium'
        | 'low' {
        const {
            packetLossHighThreshold,
            packetLossMedThreshold,
            rttHighThreshold,
            rttMedThreshold,
            bitrateMinKbps,
        } = this.opts
        let raw: 'high' | 'medium' | 'low'
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

        const order = { low: 0, medium: 1, high: 2 }
        if (raw === this._lastQuality) {
            this._streak = 0
            this._lastRaw = raw
        } else if (raw !== this._lastRaw) {
            this._streak = 1
            this._lastRaw = raw
        } else {
            this._streak++
            const threshold =
                order[raw] < order[this._lastQuality]
                    ? this.opts.downgradeStreak
                    : this.opts.upgradeStreak
            if (this._streak >= threshold) {
                this._lastQuality = raw
                this._streak = 0
            }
        }
        return this._lastQuality
    }

    reset(): void {
        this._streak = 0
        this._lastQuality = 'high'
        this._lastRaw = 'high'
    }
}
