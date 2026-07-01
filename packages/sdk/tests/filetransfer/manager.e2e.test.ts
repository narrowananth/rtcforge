import { describe, expect, it } from 'vitest'
import { FileTransferManager } from '../../src/filetransfer/FileTransferManager.js'
import type { ReceiveTransfer } from '../../src/filetransfer/ReceiveTransfer.js'
import type { FileTransferError } from '../../src/filetransfer/errors.js'
import { MemorySink } from '../../src/filetransfer/sink/MemorySink.js'
import type { SinkResult } from '../../src/filetransfer/sink/StorageSink.js'
import { TransferState } from '../../src/filetransfer/types.js'
import { MockHub, randomBytes, toBlob } from './helpers.js'

function withTimeout<T>(p: Promise<T>, ms = 3000, label = 'op'): Promise<T> {
    return Promise.race([
        p,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out`)), ms),
        ),
    ])
}

interface RoundtripResult {
    result: SinkResult
    receive: ReceiveTransfer
}

async function roundtrip(
    data: Uint8Array,
    opts: { chunkSize?: number; parallelChannels?: number; checksum?: boolean } = {},
    onOffer?: (rt: ReceiveTransfer) => void,
): Promise<RoundtripResult> {
    const [hubA, hubB] = MockHub.pair()
    const mgrA = new FileTransferManager(hubA, opts)
    const mgrB = new FileTransferManager(hubB, opts)

    const done = new Promise<RoundtripResult>((resolve, reject) => {
        mgrB.on('incoming-offer', (rt) => {
            if (onOffer) {
                onOffer(rt)
                return
            }
            rt.accept(new MemorySink())
            rt.on('complete', () => resolve({ result: rt.result as SinkResult, receive: rt }))
            rt.on('error', reject)
        })
    })

    const blob = toBlob(data)
    mgrA.sendFile('B', blob, { checksum: opts.checksum })
    return withTimeout(done, 3000, 'roundtrip')
}

describe('FileTransferManager end-to-end', () => {
    const sizes: Array<[string, number]> = [
        ['empty', 0],
        ['one byte', 1],
        ['sub-chunk', 10],
        ['exactly one chunk', 16],
        ['multi chunk', 16 * 5 + 7],
        ['>100 chunks', 16 * 137 + 3],
    ]

    for (const [name, size] of sizes) {
        it(`transfers ${name} (${size}B) byte-identically`, async () => {
            const data = randomBytes(size)
            const { result } = await roundtrip(data, { chunkSize: 16 })
            expect(result.bytes && [...result.bytes]).toEqual([...data])
        })
    }

    it('transfers with checksum disabled', async () => {
        const data = randomBytes(500)
        const { result } = await roundtrip(data, { chunkSize: 16, checksum: false })
        expect(result.bytes && [...result.bytes]).toEqual([...data])
    })

    it('reassembles correctly across parallel channels', async () => {
        const data = randomBytes(16 * 200 + 5)
        const { result } = await roundtrip(data, { chunkSize: 16, parallelChannels: 4 })
        expect(result.bytes && [...result.bytes]).toEqual([...data])
    })

    it('exposes the file blob with the advertised mime type', async () => {
        const { result, receive } = await roundtrip(randomBytes(64), { chunkSize: 16 })
        expect(receive.fileName).toBe('file')
        expect(result.blob?.type).toBe('text/plain')
    })

    it('reaches Completed state on both sides', async () => {
        const [hubA, hubB] = MockHub.pair()
        const mgrA = new FileTransferManager(hubA, { chunkSize: 16 })
        const mgrB = new FileTransferManager(hubB, { chunkSize: 16 })
        const done = new Promise<ReceiveTransfer>((resolve) => {
            mgrB.on('incoming-offer', (rt) => {
                rt.accept(new MemorySink())
                rt.on('complete', () => resolve(rt))
            })
        })
        const send = mgrA.sendFile('B', toBlob(randomBytes(100)))
        const recv = await withTimeout(done, 3000, 'complete')
        expect(recv.state).toBe(TransferState.Completed)
        expect(send.state).toBe(TransferState.Completed)
    })

    it('rejecting an offer fails the sender with OFFER_REJECTED', async () => {
        const [hubA, hubB] = MockHub.pair()
        const mgrA = new FileTransferManager(hubA, { chunkSize: 16 })
        const mgrB = new FileTransferManager(hubB, { chunkSize: 16 })
        mgrB.on('incoming-offer', (rt) => rt.reject('nope'))

        const send = mgrA.sendFile('B', toBlob(randomBytes(100)))
        const err = await withTimeout(
            new Promise<FileTransferError>((resolve) => send.on('error', resolve)),
            3000,
            'reject',
        )
        expect(err.code).toBe('FT_OFFER_REJECTED')
        expect(send.state).toBe(TransferState.Failed)
    })

    it('cancel by receiver moves both sides to a terminal state', async () => {
        const [hubA, hubB] = MockHub.pair()
        const mgrA = new FileTransferManager(hubA, { chunkSize: 16 })
        const mgrB = new FileTransferManager(hubB, { chunkSize: 16 })

        let received: ReceiveTransfer | null = null
        mgrB.on('incoming-offer', (rt) => {
            received = rt
            rt.accept(new MemorySink())
            rt.cancel('user aborted')
        })

        const send = mgrA.sendFile('B', toBlob(randomBytes(16 * 50)))
        const cancelled = await withTimeout(
            new Promise<void>((resolve) => {
                send.on('state-changed', (s) => {
                    if (s === TransferState.Cancelled) resolve()
                })
            }),
            3000,
            'cancel',
        ).catch(() => undefined)
        // cancelled resolves via state change; if the send already finished before the
        // cancel arrived it is Completed — either way it is terminal.
        void cancelled
        expect(send.isTerminal).toBe(true)
        expect((received as unknown as ReceiveTransfer).state).toBe(TransferState.Cancelled)
    })
})
