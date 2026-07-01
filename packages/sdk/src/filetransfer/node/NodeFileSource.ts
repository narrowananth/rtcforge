import { type FileHandle, open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { FileSource } from '../source/FileSource.js'

/**
 * {@link FileSource} that reads the outbound file from the Node filesystem.
 *
 * Ranges are read on demand through an `fs.promises` file handle, so large
 * files are streamed rather than loaded into memory. Construct instances with
 * the async {@link NodeFileSource.create} factory (which stats the file for its
 * size). Node-only; import from `rtcforge-sdk/filetransfer/node`.
 */
export class NodeFileSource implements FileSource {
    /** File name advertised to the receiver; defaults to the path's basename. */
    readonly name: string
    /** MIME type advertised to the receiver; defaults to `application/octet-stream`. */
    readonly mimeType: string
    /** Total file size in bytes, determined by `stat` at creation. */
    readonly size: number
    private readonly _path: string
    private _handle: FileHandle | null = null

    private constructor(path: string, size: number, name: string, mimeType: string) {
        this._path = path
        this.size = size
        this.name = name
        this.mimeType = mimeType
    }

    /**
     * Create a source for a file on disk, reading its size via `stat`.
     *
     * @param path - Path to the file to send.
     * @param opts - Optional overrides: `name` (advertised file name, defaults to the basename) and `mimeType` (defaults to `application/octet-stream`).
     * @returns A ready-to-use `NodeFileSource`.
     */
    static async create(
        path: string,
        opts: { name?: string; mimeType?: string } = {},
    ): Promise<NodeFileSource> {
        const info = await stat(path)
        return new NodeFileSource(
            path,
            info.size,
            opts.name ?? basename(path),
            opts.mimeType ?? 'application/octet-stream',
        )
    }

    /**
     * Read up to `length` bytes from `offset`, opening the file for reading on
     * first use.
     *
     * @param offset - Byte offset at which to start reading.
     * @param length - Maximum number of bytes to read; the result is truncated to the bytes actually read at end-of-file.
     * @returns The bytes read.
     */
    async slice(offset: number, length: number): Promise<ArrayBuffer> {
        if (!this._handle) this._handle = await open(this._path, 'r')
        const buf = Buffer.allocUnsafe(length)
        const { bytesRead } = await this._handle.read(buf, 0, length, offset)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead)
    }

    /** Close the open file handle, if any. */
    async close(): Promise<void> {
        if (this._handle) {
            await this._handle.close()
            this._handle = null
        }
    }
}
