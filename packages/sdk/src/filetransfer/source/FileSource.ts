/**
 * Read-only, random-access source of the bytes being sent in a transfer.
 *
 * The send pipeline reads the file in chunks via {@link FileSource.slice}, so an
 * implementation need not hold the whole file in memory. Built-in
 * implementations include {@link BlobFileSource} (browser) and `NodeFileSource`
 * (Node).
 */
export interface FileSource {
    /** File name advertised to the receiver in the transfer offer. */
    readonly name: string
    /** MIME type advertised to the receiver; defaults to `application/octet-stream` when unknown. */
    readonly mimeType: string
    /** Total size of the file in bytes. */
    readonly size: number

    /**
     * Read a contiguous range of bytes.
     *
     * @param offset - Byte offset at which to start reading.
     * @param length - Maximum number of bytes to read; the returned buffer may be shorter at end-of-file.
     * @returns The requested bytes.
     */
    slice(offset: number, length: number): Promise<ArrayBuffer>

    /** Release any resources (e.g. an open file handle) held by the source. Called when the transfer ends. */
    close?(): Promise<void> | void
}
