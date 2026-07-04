import { describe, expect, it } from 'vitest'
import { ReceiveTransfer } from '../../src/filetransfer/ReceiveTransfer.js'
import { encodeFrame } from '../../src/filetransfer/framing.js'
import { type ControlMessage, ControlType } from '../../src/filetransfer/protocol.js'
import { MemorySink } from '../../src/filetransfer/sink/MemorySink.js'
import { TransferState } from '../../src/filetransfer/types.js'
import { MockDataChannel, flush, randomBytes } from './helpers.js'

function makeReceiver(totalChunks: number, size: number) {
    const controls: ControlMessage[] = []
    const rt = new ReceiveTransfer({
        id: 't1',
        peerId: 'A',
        metadata: { name: 'f.bin', mimeType: 'application/octet-stream', size },
        chunkSize: 16,
        totalChunks,
        checksum: true,
        sendControl: (m) => controls.push(m),
    })
    return { rt, controls }
}

describe('ReceiveTransfer', () => {
    it('sends Accept with current haveChunks when accepted', async () => {
        const { rt, controls } = makeReceiver(2, 32)
        rt.accept(new MemorySink())
        await flush()
        const accept = controls.find((m) => m.type === ControlType.Accept)
        expect(accept).toBeTruthy()
        expect(rt.state).toBe(TransferState.Active)
    })

    it('reports a checksum mismatch and fails when the digest is wrong', async () => {
        const { rt, controls } = makeReceiver(2, 32)
        rt.accept(new MemorySink())
        await flush()

        const ch = new MockDataChannel('rtcforge-ft-t1-0')
        ch.readyState = 'open'
        rt.attachChannel(ch.asChannel())
        ch.dispatch('message', { data: encodeFrame(0, randomBytes(16)) })
        ch.dispatch('message', { data: encodeFrame(1, randomBytes(16)) })
        await flush()

        const failed = new Promise<void>((resolve) => rt.on('error', () => resolve()))
        rt.handleControl({ type: ControlType.Sent, transferId: 't1', digest: 'ff'.repeat(32) })
        await failed

        expect(rt.state).toBe(TransferState.Failed)
        expect(controls.some((m) => m.type === ControlType.ChecksumMismatch)).toBe(true)
    })

    it('ignores duplicate chunks', async () => {
        const { rt } = makeReceiver(1, 16)
        rt.accept(new MemorySink())
        await flush()
        const ch = new MockDataChannel('rtcforge-ft-t1-0')
        ch.readyState = 'open'
        rt.attachChannel(ch.asChannel())
        const frame = encodeFrame(0, randomBytes(16))
        ch.dispatch('message', { data: frame })
        ch.dispatch('message', { data: frame }) // duplicate
        await flush()
        expect(rt.progress().transferredChunks).toBe(1)
    })

    it('rejects an offer without starting to receive', () => {
        const { rt, controls } = makeReceiver(1, 16)
        rt.reject('busy')
        expect(rt.state).toBe(TransferState.Cancelled)
        expect(controls[0]?.type).toBe(ControlType.Reject)
    })

    it('fails on an out-of-range frame seq and cancels the peer (no huge alloc)', async () => {
        // Regression (REVIEW.md HIGH #13): a hostile seq must not drive a giant
        // sink write; it should fail the transfer and notify the sender.
        const { rt, controls } = makeReceiver(2, 32)
        rt.accept(new MemorySink())
        await flush()
        const ch = new MockDataChannel('rtcforge-ft-t1-0')
        ch.readyState = 'open'
        rt.attachChannel(ch.asChannel())

        ch.dispatch('message', { data: encodeFrame(4_000_000_000, randomBytes(16)) })
        await flush()

        expect(rt.state).toBe(TransferState.Failed)
        expect(controls.some((m) => m.type === ControlType.Cancel)).toBe(true)
    })
})
