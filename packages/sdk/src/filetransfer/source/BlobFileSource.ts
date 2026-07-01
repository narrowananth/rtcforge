import type { FileSource } from './FileSource.js'

/**
 * {@link FileSource} backed by a browser `Blob` or `File`.
 *
 * Chunks are read lazily via `Blob.slice(...).arrayBuffer()`, so large files are
 * not buffered up front. Ideal for files chosen through an `<input type="file">`.
 */
export class BlobFileSource implements FileSource {
    /** File name; taken from the explicit argument, else the `File.name`, else `'file'`. */
    readonly name: string
    /** MIME type from the blob's `type`, or `application/octet-stream` if empty. */
    readonly mimeType: string
    /** Total size of the blob in bytes. */
    readonly size: number
    private readonly _blob: Blob

    /**
     * @param blob - The `Blob` or `File` to send.
     * @param name - Optional override for the advertised file name; falls back to `File.name` then `'file'`.
     */
    constructor(blob: Blob, name?: string) {
        this._blob = blob

        const fileName = (blob as Partial<File>).name
        this.name = name ?? fileName ?? 'file'
        this.mimeType = blob.type || 'application/octet-stream'
        this.size = blob.size
    }

    /**
     * Read `length` bytes starting at `offset` by slicing the underlying blob.
     *
     * @param offset - Byte offset at which to start reading.
     * @param length - Number of bytes to read; the result is clamped at end-of-blob.
     * @returns The requested bytes.
     */
    slice(offset: number, length: number): Promise<ArrayBuffer> {
        return this._blob.slice(offset, offset + length).arrayBuffer()
    }
}
