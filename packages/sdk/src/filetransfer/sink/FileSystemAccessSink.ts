import type { FileMetadata } from '../types.js'
import type { SinkResult, StorageSink } from './StorageSink.js'

interface WritableFileStream {
    write(chunk: { type: 'write'; position: number; data: Uint8Array }): Promise<void>
    close(): Promise<void>
    abort?(reason?: unknown): Promise<void>
}

interface WritableFileHandle {
    createWritable(opts?: { keepExistingData?: boolean }): Promise<WritableFileStream>
}

/**
 * {@link StorageSink} that streams received bytes to disk through the browser
 * File System Access API.
 *
 * Data is written at absolute positions via a `FileSystemWritableFileStream`,
 * so the file need never be held in memory — suitable for large downloads. Pass
 * a `FileSystemFileHandle` obtained from `showSaveFilePicker()` or similar.
 */
export class FileSystemAccessSink implements StorageSink {
    private readonly _handle: WritableFileHandle
    private _stream: WritableFileStream | null = null

    /**
     * @param handle - A writable file handle (e.g. from `showSaveFilePicker()`) whose `createWritable` supplies the destination stream.
     */
    constructor(handle: WritableFileHandle) {
        this._handle = handle
    }

    /**
     * Open a writable stream on the handle, discarding any existing file contents.
     *
     * @param _meta - File metadata (unused; the handle already names the destination).
     */
    async open(_meta: FileMetadata): Promise<void> {
        this._stream = await this._handle.createWritable({ keepExistingData: false })
    }

    /**
     * Write a chunk at an absolute position in the file.
     *
     * @param offset - Byte position at which to write.
     * @param data - The chunk bytes.
     * @throws `Error` if called before {@link open}.
     */
    async write(offset: number, data: Uint8Array): Promise<void> {
        if (!this._stream) throw new Error('sink not opened')
        await this._stream.write({ type: 'write', position: offset, data })
    }

    /**
     * Close the writable stream, committing the file to disk.
     *
     * @returns An empty {@link SinkResult} — the data lives at the handle's location.
     */
    async close(): Promise<SinkResult> {
        if (this._stream) {
            await this._stream.close()
            this._stream = null
        }
        return {}
    }

    /**
     * Abort the writable stream, discarding partial output where the platform
     * supports it (falling back to `close` otherwise).
     *
     * @param reason - Optional cause forwarded to the stream's `abort`.
     */
    async abort(reason?: unknown): Promise<void> {
        if (this._stream) {
            await (this._stream.abort?.(reason) ?? this._stream.close())
            this._stream = null
        }
    }
}
