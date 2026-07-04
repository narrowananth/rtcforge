import { describe, expect, it } from 'vitest'
import { awaitDrain, waitForOpen } from '../../src/filetransfer/channel.js'
import { MockDataChannel, flush } from './helpers.js'

describe('backpressure gate', () => {
    it('returns immediately when buffer is below the high-water mark', async () => {
        const ch = new MockDataChannel('x')
        ch.readyState = 'open'
        ch.bufferedAmount = 100
        await awaitDrain(ch.asChannel(), 500, 100) // resolves without an event
    })

    it('waits until bufferedamountlow fires when above the high-water mark', async () => {
        const ch = new MockDataChannel('x')
        ch.readyState = 'open'
        ch.bufferedAmount = 1000

        let resolved = false
        const p = awaitDrain(ch.asChannel(), 500, 100).then(() => {
            resolved = true
        })
        await flush()
        expect(resolved).toBe(false)
        expect(ch.bufferedAmountLowThreshold).toBe(100)

        ch.bufferedAmount = 50
        ch.dispatch('bufferedamountlow')
        await p
        expect(resolved).toBe(true)
    })

    it('rejects immediately if the channel is already closed on entry', async () => {
        // Regression (re-review): close/error already fired before entry, so the
        // listeners would never trigger — must reject up front, not hang.
        const ch = new MockDataChannel('x')
        ch.readyState = 'closed'
        ch.bufferedAmount = 1000
        await expect(awaitDrain(ch.asChannel(), 500, 100, 't1')).rejects.toThrow(/is closed/)
    })

    it('rejects when the channel closes while draining (no infinite hang)', async () => {
        // Regression (REVIEW.md CRITICAL #2): a peer disconnecting while buffered
        // above the high-water mark must reject, not await bufferedamountlow forever.
        const ch = new MockDataChannel('x')
        ch.readyState = 'open'
        ch.bufferedAmount = 1000
        const p = awaitDrain(ch.asChannel(), 500, 100, 't1')
        ch.close()
        await expect(p).rejects.toThrow(/closed while draining/)
    })
})

describe('waitForOpen', () => {
    it('resolves immediately for an already-open channel', async () => {
        const ch = new MockDataChannel('x')
        ch.readyState = 'open'
        await waitForOpen(ch.asChannel())
    })

    it('resolves once the channel opens', async () => {
        const ch = new MockDataChannel('x')
        const p = waitForOpen(ch.asChannel())
        ch.open()
        await p
    })

    it('rejects if the channel closes before opening', async () => {
        const ch = new MockDataChannel('x')
        const p = waitForOpen(ch.asChannel())
        ch.close()
        await expect(p).rejects.toThrow()
    })
})
