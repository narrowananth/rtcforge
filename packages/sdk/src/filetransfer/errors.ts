import { RtcForgeError } from 'rtcforge-core'

/**
 * Machine-readable error codes carried by {@link FileTransferError}.
 *
 * Each code identifies a distinct failure mode in the file-transfer pipeline,
 * allowing callers to branch on `error.code` rather than parsing messages.
 */
export const FileTransferErrorCode = {
    /** The remote receiver declined the transfer offer (sent an `ft-reject`). */
    OfferRejected: 'FT_OFFER_REJECTED',
    /** The receiver's computed SHA-256 digest did not match the sender's, so the received data is corrupt. */
    ChecksumMismatch: 'FT_CHECKSUM_MISMATCH',
    /** The transfer was cancelled locally or by the remote peer (`ft-cancel`). */
    Cancelled: 'FT_CANCELLED',
    /** Writing a received chunk to the destination {@link StorageSink} failed. */
    SinkWriteFailed: 'FT_SINK_WRITE_FAILED',
    /** Reading a chunk from the outbound {@link FileSource} failed. */
    SourceReadFailed: 'FT_SOURCE_READ_FAILED',
    /** A required data or control channel closed before the transfer finished. */
    ChannelClosed: 'FT_CHANNEL_CLOSED',
    /** A received wire frame was malformed (too short, or an unsupported data-channel message type). */
    InvalidFrame: 'FT_INVALID_FRAME',
    /** An operation was attempted while the transfer was in an incompatible state, or a required API (e.g. WebCrypto) was unavailable. */
    InvalidState: 'FT_INVALID_STATE',
    /** An expected control message or acknowledgement did not arrive within the allotted time. */
    Timeout: 'FT_TIMEOUT',
} as const

/**
 * One of the string literal values in {@link FileTransferErrorCode}.
 */
export type FileTransferErrorCode =
    (typeof FileTransferErrorCode)[keyof typeof FileTransferErrorCode]

/**
 * Error thrown by the file-transfer subsystem.
 *
 * Extends the core `RtcForgeError` with a {@link FileTransferErrorCode} and,
 * when known, the id of the transfer the failure belongs to.
 */
export class FileTransferError extends RtcForgeError {
    /** Id of the transfer this error relates to, if it was raised in the context of a specific transfer. */
    readonly transferId?: string

    /**
     * @param message - Human-readable description of the failure.
     * @param code - Machine-readable {@link FileTransferErrorCode} for branching.
     * @param options - Optional `cause` to chain the underlying error and `transferId` to associate the error with a transfer.
     */
    constructor(
        message: string,
        code: FileTransferErrorCode,
        options?: { cause?: unknown; transferId?: string },
    ) {
        super(message, code, options)
        this.transferId = options?.transferId
    }
}
