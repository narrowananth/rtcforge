import type { NetworkStats } from 'rtcforge-core'
import { noopLogger } from './types.js'
import type { BandwidthEstimator, BandwidthQuality, Logger } from './types.js'

/**
 * Polls network stats on an interval and reports estimated bandwidth quality.
 *
 * @remarks
 * On {@link StatsCollector.start | start} it samples `getStats` every
 * `intervalMs`, feeds each sample to a {@link BandwidthEstimator}, and invokes
 * `onQuality` with the resulting {@link BandwidthQuality}. Overlapping collections
 * are guarded so a slow stats call can't stack, and the timer is `unref`'d so it
 * never keeps the process alive. Call {@link StatsCollector.stop | stop} to halt.
 */
export class StatsCollector {
    private _timer: ReturnType<typeof setInterval> | null = null
    private _collecting = false

    constructor(
        private readonly estimator: BandwidthEstimator,
        private readonly getStats: () => Promise<NetworkStats>,
        private readonly onQuality: (quality: BandwidthQuality) => void,
        private readonly intervalMs = 5000,
        private readonly logger: Logger = noopLogger,
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
        } catch (err) {
            // Don't let a failing stats provider throw out of the interval
            // callback, but surface it so a permanently-broken provider is
            // diagnosable rather than silently starving bandwidth estimates.
            this.logger.warn('Stats collection failed', {
                err: err instanceof Error ? err.message : String(err),
            })
        } finally {
            this._collecting = false
        }
    }
}
