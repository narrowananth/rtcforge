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
