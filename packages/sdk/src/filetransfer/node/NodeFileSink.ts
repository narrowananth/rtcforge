import { type FileHandle, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeFileName } from '../sanitize.js'
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
    private _path: string
    // When set, the write path is derived from the transfer metadata at open() time
    // by joining this directory with a sanitized file name; null for a fixed path.
    private readonly _dir: string | null
    private _handle: FileHandle | null = null

    /**
     * @param path - Destination filesystem path; opened for writing (truncating any existing file).
     * @param deriveName - Internal; when `true`, `path` is treated as a directory and the
     *   final file name is derived from the (sanitized) transfer metadata at open() time.
     *   Prefer {@link NodeFileSink.intoDirectory}.
     */
    constructor(path: string, deriveName = false) {
        this._path = path
        this._dir = deriveName ? path : null
    }

    /**
     * Create a sink that writes into `dir`, deriving the file name from the transfer
     * metadata with {@link sanitizeFileName} applied automatically. This neutralizes
     * path-traversal / absolute names (`../../etc/passwd`, `C:\evil`) from a hostile
     * peer by default, so the written file can never escape `dir`.
     *
     * @param dir - Destination directory the received file is written into.
     */
    static intoDirectory(dir: string): NodeFileSink {
        return new NodeFileSink(dir, true)
    }

    /**
     * Open the destination file for writing, truncating any existing contents. In
     * directory mode the final path is resolved here from the (sanitized) metadata name.
     *
     * @param meta - File metadata; its name is used (sanitized) only in directory mode.
     */
    async open(meta: FileMetadata): Promise<void> {
        if (this._dir !== null) {
            this._path = join(this._dir, sanitizeFileName(meta.name))
        }
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
