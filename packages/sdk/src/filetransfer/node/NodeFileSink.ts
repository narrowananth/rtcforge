import { type FileHandle, open, unlink } from 'node:fs/promises'
import type { SinkResult, StorageSink } from '../sink/StorageSink.js'
import type { FileMetadata } from '../types.js'

/**
 * {@link StorageSink} that writes received bytes directly to a file on the Node
 * filesystem.
 *
 * Chunks are written at absolute offsets through an `fs.promises` file handle,
 * so files never need to be buffered in memory. Node-only; import from
 * `rtcforge-sdk/filetransfer/node`.
 */
export class NodeFileSink implements StorageSink {
    private readonly _path: string
    private _handle: FileHandle | null = null

    /**
     * @param path - Destination filesystem path; opened for writing (truncating any existing file).
     */
    constructor(path: string) {
        this._path = path
    }

    /**
     * Open the destination file for writing, truncating any existing contents.
     *
     * @param _meta - File metadata (unused; the destination path is fixed at construction).
     */
    async open(_meta: FileMetadata): Promise<void> {
        this._handle = await open(this._path, 'w')
    }

    /**
     * Write a chunk at an absolute file offset, opening the file first if needed.
     *
     * @param offset - Byte offset at which to write.
     * @param data - The chunk bytes.
     */
    async write(offset: number, data: Uint8Array): Promise<void> {
        if (!this._handle) this._handle = await open(this._path, 'w')
        await this._handle.write(data, 0, data.byteLength, offset)
    }

    /**
     * Close the file handle.
     *
     * @returns A {@link SinkResult} whose `path` is the destination file path.
     */
    async close(): Promise<SinkResult> {
        if (this._handle) {
            await this._handle.close()
            this._handle = null
        }
        return { path: this._path }
    }

    /** Close the handle and delete the partially written file (ignoring unlink errors). */
    async abort(): Promise<void> {
        if (this._handle) {
            await this._handle.close()
            this._handle = null
        }
        await unlink(this._path).catch(() => undefined)
    }
}
