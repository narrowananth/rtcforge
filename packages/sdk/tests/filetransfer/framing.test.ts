import { describe, expect, it } from 'vitest'
import { FileTransferError } from '../../src/filetransfer/errors.js'
import {
    FRAME_HEADER_BYTES,
    decodeFrame,
    encodeFrame,
    toArrayBuffer,
} from '../../src/filetransfer/framing.js'
import { randomBytes } from './helpers.js'

describe('framing', () => {
    it('roundtrips seq and payload', () => {
        const payload = randomBytes(1000)
        const frame = encodeFrame(1234, payload)
        expect(frame.byteLength).toBe(FRAME_HEADER_BYTES + payload.byteLength)
        const decoded = decodeFrame(frame)
        expect(decoded.seq).toBe(1234)
        expect([...decoded.payload]).toEqual([...payload])
    })

    it('handles empty payload', () => {
        const decoded = decodeFrame(encodeFrame(0, new Uint8Array(0)))
        expect(decoded.seq).toBe(0)
        expect(decoded.payload.byteLength).toBe(0)
    })

    it('handles the max uint32 sequence', () => {
        const decoded = decodeFrame(encodeFrame(0xffffffff, new Uint8Array([9])))
        expect(decoded.seq).toBe(0xffffffff)
        expect(decoded.payload[0]).toBe(9)
    })

    it('rejects a truncated frame', () => {
        expect(() => decodeFrame(new ArrayBuffer(2))).toThrow(FileTransferError)
    })

    it('normalizes ArrayBuffer / view / Blob via toArrayBuffer', async () => {
        const buf = randomBytes(8).buffer
        expect(await toArrayBuffer(buf)).toBe(buf)
        const view = new Uint8Array([1, 2, 3])
        expect(new Uint8Array(await toArrayBuffer(view))).toEqual(view)
        const blob = new Blob([new Uint8Array([4, 5])])
        expect(new Uint8Array(await toArrayBuffer(blob))).toEqual(new Uint8Array([4, 5]))
    })
})
