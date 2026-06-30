import type { NetworkStats } from '@rtcforge/core'
import { describe, expect, it } from 'vitest'
import { SimpleBandwidthEstimator } from '../src/SimpleBandwidthEstimator.js'

const HIGH: NetworkStats = { packetLoss: 0, rtt: 0, bitrate: 1_000_000 }
const MEDIUM: NetworkStats = { packetLoss: 0.05, rtt: 0, bitrate: 1_000_000 }
const LOW: NetworkStats = { packetLoss: 0.2, rtt: 0, bitrate: 1_000_000 }

const feed = (est: SimpleBandwidthEstimator, seq: NetworkStats[]) =>
    seq.map((s) => est.estimate(s)).at(-1)

describe('SimpleBandwidthEstimator', () => {
    it('starts at high', () => {
        expect(new SimpleBandwidthEstimator().estimate(HIGH)).toBe('high')
    })

    it('ignores a single transient degraded reading (no downgrade on one blip)', () => {
        const est = new SimpleBandwidthEstimator()
        est.estimate(HIGH)
        expect(est.estimate(LOW)).toBe('high')
        expect(est.estimate(HIGH)).toBe('high')
    })

    it('never jumps two levels on noise — steps high→medium, not high→low', () => {
        const est = new SimpleBandwidthEstimator()
        est.estimate(HIGH)
        expect(feed(est, [MEDIUM, LOW])).toBe('medium')
    })

    it('downgrades on a noisy-but-sustained departure (the stall the old logic missed)', () => {
        const est = new SimpleBandwidthEstimator()
        est.estimate(HIGH)
        expect(feed(est, [MEDIUM, LOW])).toBe('medium')
        expect(feed(est, [LOW, LOW])).toBe('low')
    })

    it('upgrades only after a sustained recovery, one step at a time', () => {
        const est = new SimpleBandwidthEstimator()
        feed(est, [MEDIUM, LOW, LOW, LOW])
        expect(feed(est, [HIGH, HIGH, HIGH])).not.toBe('high')
    })

    it('reset returns to high', () => {
        const est = new SimpleBandwidthEstimator()
        feed(est, [LOW, LOW, LOW])
        est.reset()
        expect(est.estimate(HIGH)).toBe('high')
    })
})
