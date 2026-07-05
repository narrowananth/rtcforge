import { describe, expect, it } from 'vitest'
import { ControlLink } from '../../src/filetransfer/ControlLink.js'
import { ControlType } from '../../src/filetransfer/protocol.js'
import { MockDataChannel } from './helpers.js'

describe('ControlLink', () => {
    it('flushes queued messages once the channel opens', () => {
        const ch = new MockDataChannel('rtcforge-ft-ctrl')
        const link = new ControlLink(ch.asChannel(), () => {})
        link.send({ type: ControlType.Pause, transferId: 't1' })
        link.send({ type: ControlType.Resume, transferId: 't1' })
        expect(ch.sent).toHaveLength(0) // still connecting
        ch.open()
        expect(ch.sent).toHaveLength(2)
    })

    it('caps the pre-open backlog so a never-opening channel cannot grow unbounded', () => {
        const ch = new MockDataChannel('rtcforge-ft-ctrl')
        const link = new ControlLink(ch.asChannel(), () => {})
        // Queue far more than the cap while the channel stays 'connecting'.
        const total = 3000
        for (let i = 0; i < total; i += 1) {
            link.send({ type: ControlType.Cancel, transferId: `t${i}` })
        }
        ch.open()
        // Only the most recent MAX_QUEUE (1024) messages survive; the oldest are dropped.
        expect(ch.sent).toHaveLength(1024)
        const first = JSON.parse(ch.sent[0] as string)
        const last = JSON.parse(ch.sent[ch.sent.length - 1] as string)
        expect(first.transferId).toBe(`t${total - 1024}`)
        expect(last.transferId).toBe(`t${total - 1}`)
    })
})
