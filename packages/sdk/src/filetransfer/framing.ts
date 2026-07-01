import { FileTransferError, FileTransferErrorCode } from './errors.js'

/**
 * Size in bytes of the fixed frame header that prefixes every chunk payload.
 *
 * The header is a single big-endian `uint32` holding the chunk sequence number.
 */
export const FRAME_HEADER_BYTES = 4

/**
 * Encode a data-channel frame: a {@link FRAME_HEADER_BYTES}-byte big-endian
 * `uint32` sequence number followed by the raw chunk payload.
 *
 * The sequence number lets the receiver place each chunk at the correct file
 * offset regardless of arrival order or which parallel channel delivered it.
 *
 * @param seq - Zero-based chunk sequence number, written as a big-endian `uint32`.
 * @param payload - The chunk bytes to append after the header.
 * @returns A newly allocated `ArrayBuffer` containing the header and payload.
 */
export function encodeFrame(seq: number, payload: ArrayBuffer | Uint8Array): ArrayBuffer {
    const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
    const frame = new Uint8Array(FRAME_HEADER_BYTES + body.byteLength)
    new DataView(frame.buffer).setUint32(0, seq, false)
    frame.set(body, FRAME_HEADER_BYTES)
    return frame.buffer
}

/**
 * A frame parsed by {@link decodeFrame}.
 */
export interface DecodedFrame {
    /** Chunk sequence number read from the big-endian `uint32` header. */
    readonly seq: number

    /** View over the chunk payload bytes, aliasing the source buffer (no copy). */
    readonly payload: Uint8Array
}

/**
 * Decode a data-channel frame produced by {@link encodeFrame}.
 *
 * @param data - The received frame buffer (header plus payload).
 * @returns The parsed `DecodedFrame`; `payload` is a zero-copy view into `data`.
 * @throws {@link FileTransferError} with code `FT_INVALID_FRAME` if the buffer is smaller than the header.
 */
export function decodeFrame(data: ArrayBuffer): DecodedFrame {
    if (data.byteLength < FRAME_HEADER_BYTES) {
        throw new FileTransferError(
            `frame too small: ${data.byteLength} bytes`,
            FileTransferErrorCode.InvalidFrame,
        )
    }
    const seq = new DataView(data).getUint32(0, false)
    const payload = new Uint8Array(data, FRAME_HEADER_BYTES)
    return { seq, payload }
}

export async function toArrayBuffer(data: unknown): Promise<ArrayBuffer> {
    if (data instanceof ArrayBuffer) return data
    if (ArrayBuffer.isView(data)) {
        const view = data as ArrayBufferView
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.arrayBuffer()
    throw new FileTransferError(
        `unsupported data-channel message type: ${typeof data}`,
        FileTransferErrorCode.InvalidFrame,
    )
}
