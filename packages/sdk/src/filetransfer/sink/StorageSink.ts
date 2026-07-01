import type { FileMetadata } from '../types.js'

/**
 * Outcome of a completed transfer, returned by {@link StorageSink.close}.
 *
 * Which fields are populated depends on the sink: in-memory sinks return
 * `blob`/`bytes`, filesystem sinks return a `path`.
 */
export interface SinkResult {
    /** The received data as a `Blob`, when the sink materialised one. */
    readonly blob?: Blob
    /** The received data as raw bytes, when the sink materialised them. */
    readonly bytes?: Uint8Array

    /** Filesystem path the data was written to, for file-backed sinks. */
    readonly path?: string
}

/**
 * Random-access destination for received file bytes.
 *
 * The receive pipeline writes chunks at their file offsets via
 * {@link StorageSink.write} (order-independent), then calls {@link close} on
 * success or {@link abort} on failure. Built-in implementations include
 * {@link MemorySink}, {@link FileSystemAccessSink}, and `NodeFileSink`.
 */
export interface StorageSink {
    /**
     * Prepare the sink for writing, given the file's metadata (e.g. pre-allocate
     * a buffer or open a file handle). Called once before the first {@link write}.
     *
     * @param meta - Name, size, and MIME type of the incoming file.
     */
    open?(meta: FileMetadata): Promise<void> | void

    /**
     * Write a chunk at an absolute file offset. Chunks may arrive out of order.
     *
     * @param offset - Byte offset within the file at which to write.
     * @param data - The chunk bytes.
     */
    write(offset: number, data: Uint8Array): Promise<void>

    /**
     * Finalise the destination and return the result.
     *
     * @returns A {@link SinkResult} describing where/how the data was stored.
     */
    close(): Promise<SinkResult>

    /**
     * Abandon the transfer and discard any partial output (e.g. free the buffer
     * or delete the partial file).
     *
     * @param reason - Optional cause of the abort.
     */
    abort(reason?: unknown): Promise<void> | void
}
