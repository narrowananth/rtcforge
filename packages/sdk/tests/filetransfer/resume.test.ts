import { describe, expect, it } from 'vitest'
import { ReceiveTransfer } from '../../src/filetransfer/ReceiveTransfer.js'
import { SendTransfer } from '../../src/filetransfer/SendTransfer.js'
import { decodeFrame, encodeFrame, toArrayBuffer } from '../../src/filetransfer/framing.js'
import { type ControlMessage, ControlType } from '../../src/filetransfer/protocol.js'
import { MemorySink } from '../../src/filetransfer/sink/MemorySink.js'
import { BlobFileSource } from '../../src/filetransfer/source/BlobFileSource.js'
import { TransferState } from '../../src/filetransfer/types.js'
import { MockDataChannel, flush, randomBytes, toBlob } from './helpers.js'

describe('filetransfer resume', () => {
    it('sender resends only the chunks the receiver is missing', async () => {
        const data = randomBytes(16 * 4) // 4 chunks at chunkSize 16
        const source = new BlobFileSource(toBlob(data))

        const chA = new MockDataChannel('rtcforge-ft-t1-0')
        const chB = new MockDataChannel('rtcforge-ft-t1-0')
        chA.peer = chB
        chB.peer = chA
        chA.open()
        chB.open()

        const received: number[] = []
        chB.asChannel().addEventListener('message', async (ev: MessageEvent) => {
            received.push(decodeFrame(await toArrayBuffer(ev.data)).seq)
        })

        const send = new SendTransfer({
            id: 't1',
            peerId: 'B',
            source,
            channels: [chA.asChannel()],
            sendControl: () => {},
            chunkSize: 16,
            highWaterMark: 1 << 20,
            lowWaterMark: 1 << 10,
            checksum: false,
            offerTimeoutMs: 0,
            resumable: true,
        })
        send.start()
        // Receiver already holds chunks 0 and 2 → resume request for the rest.
        send.handleControl({
            type: ControlType.ResumeRequest,
            transferId: 't1',
            haveChunks: [0, 2],
        })
        await flush()

        expect(received.sort((a, b) => a - b)).toEqual([1, 3]) // only the missing chunks
    })

    it('ReceiveTransfer.requestResume reports the chunks already received', async () => {
        const controls: ControlMessage[] = []
        const rt = new ReceiveTransfer({
            id: 't1',
            peerId: 'A',
            metadata: { name: 'f.bin', mimeType: 'application/octet-stream', size: 16 * 4 },
            chunkSize: 16,
            totalChunks: 4,
            checksum: false,
            sendControl: (m) => controls.push(m),
        })
        rt.accept(new MemorySink())
        await flush()

        const ch = new MockDataChannel('rtcforge-ft-t1-0')
        ch.open()
        rt.attachChannel(ch.asChannel())
        ch.dispatch('message', { data: encodeFrame(0, randomBytes(16)) })
        ch.dispatch('message', { data: encodeFrame(2, randomBytes(16)) })
        await flush()

        rt.requestResume()
        const rr = controls.find((m) => m.type === ControlType.ResumeRequest) as
            | Extract<ControlMessage, { type: 'ft-resume-request' }>
            | undefined
        expect(rr?.haveChunks.slice().sort((a, b) => a - b)).toEqual([0, 2])
    })

    it('a duplicate Accept does not spawn a second concurrent worker set', async () => {
        const data = randomBytes(16 * 3)
        const source = new BlobFileSource(toBlob(data))
        const chA = new MockDataChannel('rtcforge-ft-t1-0')
        const chB = new MockDataChannel('rtcforge-ft-t1-0')
        chA.peer = chB
        chB.peer = chA
        chA.open()
        chB.open()
        const received: number[] = []
        chB.asChannel().addEventListener('message', async (ev: MessageEvent) => {
            received.push(decodeFrame(await toArrayBuffer(ev.data)).seq)
        })

        const send = new SendTransfer({
            id: 't1',
            peerId: 'B',
            source,
            channels: [chA.asChannel()],
            sendControl: () => {},
            chunkSize: 16,
            highWaterMark: 1 << 20,
            lowWaterMark: 1 << 10,
            checksum: false,
            offerTimeoutMs: 0,
            resumable: true,
        })
        send.start()
        send.handleControl({ type: ControlType.Accept, transferId: 't1' })
        send.handleControl({ type: ControlType.Accept, transferId: 't1' }) // duplicate
        await flush()

        // Each chunk sent exactly once despite the duplicate accept.
        expect(received.slice().sort((a, b) => a - b)).toEqual([0, 1, 2])
    })

    it('reoffer closes survivor channels from the previous set instead of leaking them', async () => {
        // Regression: on a partial drop with parallelChannels>1, the still-open
        // survivor channel from the interrupted run must be closed by reoffer, not
        // orphaned when _channels is reassigned.
        const data = randomBytes(16 * 40)
        const source = new BlobFileSource(toBlob(data))

        const chA0 = new MockDataChannel('rtcforge-ft-t1-0')
        const chA1 = new MockDataChannel('rtcforge-ft-t1-1')
        chA0.peer = new MockDataChannel('peer0')
        chA1.peer = new MockDataChannel('peer1')
        chA0.open()
        chA1.open()
        // Park worker #1 in awaitDrain (open channel, buffer above HWM) so it never
        // completes and chA1 stays open as the survivor.
        chA1.bufferedAmount = 2_000_000

        const send = new SendTransfer({
            id: 't1',
            peerId: 'B',
            source,
            channels: [chA0.asChannel(), chA1.asChannel()],
            sendControl: () => {},
            chunkSize: 16,
            highWaterMark: 1_000_000,
            lowWaterMark: 1 << 10,
            checksum: false,
            offerTimeoutMs: 0,
            resumable: true,
        })
        send.start()
        send.handleControl({ type: ControlType.Accept, transferId: 't1' })
        // Drop channel #0 to interrupt the run.
        chA0.close()
        await flush()

        expect(send.interrupted).toBe(true)
        expect(chA1.readyState).toBe('open') // survivor still open pre-reoffer

        const newA0 = new MockDataChannel('rtcforge-ft-t1-0')
        const newA1 = new MockDataChannel('rtcforge-ft-t1-1')
        newA0.open()
        newA1.open()
        send.reoffer([newA0.asChannel(), newA1.asChannel()])

        expect(chA1.readyState).toBe('closed') // survivor closed by reoffer
        send.cancel()
    })

    it('receiver rejects completion when checksum required but sender sends no digest', async () => {
        const controls: ControlMessage[] = []
        const rt = new ReceiveTransfer({
            id: 't1',
            peerId: 'A',
            metadata: { name: 'f.bin', mimeType: 'application/octet-stream', size: 16 },
            chunkSize: 16,
            totalChunks: 1,
            checksum: true, // receiver requires integrity
            sendControl: (m) => controls.push(m),
        })
        rt.accept(new MemorySink())
        await flush()
        const ch = new MockDataChannel('rtcforge-ft-t1-0')
        ch.open()
        rt.attachChannel(ch.asChannel())
        ch.dispatch('message', { data: encodeFrame(0, randomBytes(16)) })
        await flush()

        const failed = new Promise<void>((resolve) => rt.on('error', () => resolve()))
        rt.handleControl({ type: ControlType.Sent, transferId: 't1' }) // no digest
        await failed

        expect(rt.state).toBe(TransferState.Failed)
        expect(controls.some((m) => m.type === ControlType.ChecksumMismatch)).toBe(true)
    })
})
