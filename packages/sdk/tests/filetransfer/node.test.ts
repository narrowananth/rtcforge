import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileTransferManager } from '../../src/filetransfer/FileTransferManager.js'
import type { ReceiveTransfer } from '../../src/filetransfer/ReceiveTransfer.js'
import { sha256Hex } from '../../src/filetransfer/checksum.js'
import { NodeFileSink } from '../../src/filetransfer/node/NodeFileSink.js'
import { NodeFileSource } from '../../src/filetransfer/node/NodeFileSource.js'
import { MockHub, randomBytes } from './helpers.js'

let dir: string

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rtcforge-ft-'))
})
afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
})

describe('Node file source/sink integration', () => {
    it('roundtrips a real file on disk with matching checksum', async () => {
        const srcPath = join(dir, 'src.bin')
        const dstPath = join(dir, 'dst.bin')
        const data = randomBytes(64 * 1024 + 123) // multi-chunk
        await writeFile(srcPath, data)

        const [hubA, hubB] = MockHub.pair()
        const mgrA = new FileTransferManager(hubA)
        const mgrB = new FileTransferManager(hubB)

        const done = new Promise<void>((resolve, reject) => {
            mgrB.on('incoming-offer', (rt: ReceiveTransfer) => {
                rt.accept(new NodeFileSink(dstPath))
                rt.on('complete', () => resolve())
                rt.on('error', reject)
            })
        })

        const source = await NodeFileSource.create(srcPath)
        mgrA.sendFile('B', source)

        await Promise.race([
            done,
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ])

        const written = await readFile(dstPath)
        expect(written.byteLength).toBe(data.byteLength)
        expect(await sha256Hex(written)).toBe(await sha256Hex(data))
    })

    it('NodeFileSink.intoDirectory sanitizes a hostile metadata name (no traversal)', async () => {
        // Regression: a path-traversal file name must be neutralized automatically
        // so the write stays inside the target directory.
        const sink = NodeFileSink.intoDirectory(dir)
        const bytes = randomBytes(64)
        await sink.open({ name: '../../evil.bin', mimeType: '', size: bytes.byteLength })
        await sink.write(0, bytes)
        const result = await sink.close()

        // The file lands at <dir>/evil.bin, never outside dir.
        expect(result.path).toBe(join(dir, 'evil.bin'))
        const written = await readFile(join(dir, 'evil.bin'))
        expect(written.byteLength).toBe(bytes.byteLength)
    })
})
