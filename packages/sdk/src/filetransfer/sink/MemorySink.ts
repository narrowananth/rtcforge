import type { FileMetadata } from '../types.js'
import type { SinkResult, StorageSink } from './StorageSink.js'

/**
 * {@link StorageSink} that accumulates the received file in a single in-memory
 * buffer.
 *
 * Suitable for small-to-moderate files where the whole payload can fit in
 * memory. The buffer is pre-sized from the file metadata and grown on demand if
 * a write extends past its end.
 */
export class MemorySink implements StorageSink {
    private _buffer: Uint8Array | null = null
    private _mime = 'application/octet-stream'

    /**
     * Pre-allocate the buffer to the declared file size and record the MIME type
     * used for the resulting `Blob`.
     *
     * @param meta - Name, size, and MIME type of the incoming file.
     */
    open(meta: FileMetadata): void {
        this._buffer = new Uint8Array(meta.size)
        this._mime = meta.mimeType || this._mime
    }

    /**
     * Copy a chunk into the buffer at `offset`, growing the buffer if the write
     * extends past its current end.
     *
     * @param offset - Byte offset at which to write.
     * @param data - The chunk bytes.
     */
    write(offset: number, data: Uint8Array): Promise<void> {
        if (!this._buffer) this._buffer = new Uint8Array(offset + data.byteLength)
        if (offset + data.byteLength > this._buffer.byteLength) {
            const grown = new Uint8Array(offset + data.byteLength)
            grown.set(this._buffer)
            this._buffer = grown
        }
        this._buffer.set(data, offset)
        return Promise.resolve()
    }

    /**
     * @returns A {@link SinkResult} with the accumulated `bytes` and, where `Blob` is available, a `blob` of the recorded MIME type.
     */
    close(): Promise<SinkResult> {
        const bytes = this._buffer ?? new Uint8Array(0)
        const result: SinkResult = {
            bytes,
            blob:
                typeof Blob !== 'undefined'
                    ? new Blob([bytes as unknown as BlobPart], { type: this._mime })
                    : undefined,
        }
        return Promise.resolve(result)
    }

    /** Discard the buffered data. */
    abort(): void {
        this._buffer = null
    }
}
