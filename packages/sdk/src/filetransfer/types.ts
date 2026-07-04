/**
 * Abstraction over the peer connection layer that the file-transfer engine uses to
 * open and receive {@link RTCDataChannel}s.
 *
 * This is the integration seam between the file-transfer module and whatever manages
 * the underlying `RTCPeerConnection`s (for example an application's call/mesh layer).
 * A {@link FileTransferManager} opens outbound channels through it and listens for
 * inbound ones to drive the transfer protocol.
 *
 * @remarks
 * Data channels carry two kinds of traffic: a single JSON control channel per peer
 * (labelled {@link CONTROL_CHANNEL_LABEL}) and one or more binary chunk channels per
 * transfer (labelled via {@link dataChannelLabel}). Implementations should surface
 * every remotely-initiated channel through the `data-channel` event.
 */
export interface DataChannelHub {
    /**
     * Opens an outbound data channel to `peerId`.
     *
     * @param peerId - Identifier of the remote peer to open a channel to.
     * @param label - Channel label; the transfer engine encodes routing information here.
     * @param opts - Optional `RTCDataChannel` configuration (the engine requests `ordered: true`).
     * @returns The new channel, or `undefined` if there is no active connection to `peerId`.
     */
    createDataChannel(
        peerId: string,
        label: string,
        opts?: RTCDataChannelInit,
    ): RTCDataChannel | undefined
    /**
     * Subscribes to remotely-initiated data channels.
     *
     * @param event - Always `'data-channel'`.
     * @param handler - Invoked with the originating peer id and the newly opened channel.
     */
    on(event: 'data-channel', handler: (peerId: string, channel: RTCDataChannel) => void): void
    /**
     * Removes a previously registered `data-channel` listener.
     *
     * @param event - Always `'data-channel'`.
     * @param handler - The exact handler reference passed to {@link DataChannelHub.on}.
     */
    off(event: 'data-channel', handler: (peerId: string, channel: RTCDataChannel) => void): void
}

/**
 * Lifecycle states of a {@link Transfer}. A transfer advances monotonically toward one of
 * the three terminal states ({@link TransferState.Completed}, {@link TransferState.Failed},
 * {@link TransferState.Cancelled}).
 */
export const TransferState = {
    /** Newly constructed; nothing has been sent or offered yet. */
    Idle: 'idle',
    /** An offer has been sent (sender) or received (receiver) and is awaiting acceptance. */
    Offered: 'offered',
    /** The offer was accepted; the transfer is preparing to move bytes. */
    Accepted: 'accepted',
    /** Chunks are actively flowing across the data channel(s). */
    Active: 'active',
    /** Transfer is temporarily suspended and will resume where it left off. */
    Paused: 'paused',
    /** All bytes have been exchanged; finalizing (checksum verification, sink close). */
    Completing: 'completing',
    /** Terminal: the file was transferred (and verified when checksums are enabled). */
    Completed: 'completed',
    /** Terminal: the transfer aborted because of an error. */
    Failed: 'failed',
    /** Terminal: the transfer was cancelled by either peer. */
    Cancelled: 'cancelled',
} as const

/** One of the {@link TransferState} string literals. */
export type TransferState = (typeof TransferState)[keyof typeof TransferState]

/** Direction of a {@link Transfer} relative to the local peer. */
export const TransferDirection = {
    /** The local peer is sending the file. */
    Send: 'send',
    /** The local peer is receiving the file. */
    Receive: 'receive',
} as const

/** One of the {@link TransferDirection} string literals. */
export type TransferDirection = (typeof TransferDirection)[keyof typeof TransferDirection]

/** Events emitted by an individual {@link Transfer}. */
export const TransferEvent = {
    /** Fires on every state change, with the new and previous {@link TransferState}. */
    StateChanged: 'state-changed',
    /** Fires as bytes move, carrying a {@link TransferProgress} snapshot. */
    Progress: 'progress',
    /** Fires once when the transfer reaches {@link TransferState.Completed}, with the transfer id. */
    Complete: 'complete',
    /** Fires when the transfer fails or is cancelled with a reason, carrying a {@link FileTransferError}. */
    Error: 'error',
} as const

/** One of the {@link TransferEvent} string literals. */
export type TransferEvent = (typeof TransferEvent)[keyof typeof TransferEvent]

/** Events emitted by a {@link FileTransferManager}. */
export const FileTransferEvent = {
    /** Fires when a remote peer offers a file, carrying a not-yet-accepted {@link ReceiveTransfer}. */
    IncomingOffer: 'incoming-offer',
    /** Fires on manager-level errors (for example an unparseable control message), carrying a {@link FileTransferError}. */
    Error: 'error',
} as const

/** One of the {@link FileTransferEvent} string literals. */
export type FileTransferEvent = (typeof FileTransferEvent)[keyof typeof FileTransferEvent]

/** Descriptive metadata for the file being transferred, carried in the offer. */
export interface FileMetadata {
    /** File name. */
    readonly name: string
    /** MIME type (empty string when unknown). */
    readonly mimeType: string
    /** Total size in bytes. */
    readonly size: number
}

/** Immutable snapshot of a transfer's progress, emitted with {@link TransferEvent.Progress}. */
export interface TransferProgress {
    /** Identifier of the transfer this snapshot describes. */
    readonly transferId: string
    /** Bytes transferred so far. */
    readonly transferredBytes: number
    /** Total bytes to transfer (the file size). */
    readonly totalBytes: number
    /** Fraction complete in the range `[0, 1]`. */
    readonly ratio: number
    /** Number of chunks transferred so far. */
    readonly transferredChunks: number
    /** Total number of chunks the file is split into. */
    readonly totalChunks: number
}

/** Performance knobs shared by the manager and per-send options. All fields fall back to module defaults. */
export interface TransferTuning {
    /**
     * Payload bytes per chunk (excluding the frame header).
     * @defaultValue {@link DEFAULT_CHUNK_SIZE}
     */
    chunkSize?: number

    /**
     * Data-channel `bufferedAmount` (bytes) at which the sender pauses to apply backpressure.
     * @defaultValue {@link DEFAULT_HIGH_WATER_MARK}
     */
    highWaterMark?: number

    /**
     * `bufferedAmountLowThreshold` (bytes) at which the paused sender resumes.
     * @defaultValue {@link DEFAULT_LOW_WATER_MARK}
     */
    lowWaterMark?: number

    /**
     * Number of parallel binary data channels opened per transfer; chunks are striped across them.
     * @defaultValue {@link DEFAULT_PARALLEL_CHANNELS}
     */
    parallelChannels?: number

    /**
     * Milliseconds a sender waits for the receiver to accept an offer before the
     * transfer fails (releasing its open channels). `0` disables the timeout.
     * @defaultValue {@link DEFAULT_OFFER_TIMEOUT_MS}
     */
    offerTimeoutMs?: number
}

/** Options accepted by the {@link FileTransferManager} constructor. */
export interface FileTransferOptions extends TransferTuning {
    /**
     * Whether to compute and verify a SHA-256 checksum over the file.
     * @defaultValue `true`
     */
    checksum?: boolean

    /**
     * Upper bound (bytes) on an inbound offer's declared file size. Offers
     * larger than this are auto-rejected before a {@link ReceiveTransfer} is
     * created, blunting memory/disk-exhaustion from a hostile `size`. Omit for
     * no limit. @defaultValue unlimited
     */
    maxFileSize?: number
    /**
     * When `true`, a mid-transfer data-channel drop **pauses** the send instead of
     * failing it; re-announcing on reconnected channels
     * ({@link FileTransferManager.resumeSend}) resends only the chunks the receiver
     * is still missing. In-session only (state is not persisted across reloads),
     * and best used with `checksum: false`. @defaultValue `false`
     */
    resumable?: boolean
}

/** Per-send overrides accepted by {@link FileTransferManager.sendFile}; merged over the manager defaults. */
export interface SendOptions extends TransferTuning {
    /** Explicit transfer id; a random id is generated when omitted. */
    transferId?: string
    /**
     * Whether to compute and verify a SHA-256 checksum for this transfer.
     * @defaultValue inherited from the manager (`true` unless overridden)
     */
    checksum?: boolean
}

/** Fully-resolved tuning with every field populated; produced by {@link resolveTuning}. */
export interface ResolvedTuning {
    /** Payload bytes per chunk. */
    readonly chunkSize: number
    /** Backpressure high-water mark in bytes. */
    readonly highWaterMark: number
    /** Backpressure low-water mark in bytes. */
    readonly lowWaterMark: number
    /** Number of parallel data channels per transfer. */
    readonly parallelChannels: number
    /** Whether SHA-256 checksum verification is enabled. */
    readonly checksum: boolean
    /** Upper bound (bytes) on an accepted inbound offer's size; `undefined` = unlimited. */
    readonly maxFileSize: number | undefined
    /** Milliseconds a sender waits for an accept before failing; `0` disables. */
    readonly offerTimeoutMs: number
    /** Whether a mid-transfer channel drop pauses (resumable) instead of failing. */
    readonly resumable: boolean
}

/**
 * Default chunk payload size: 16 KiB minus the 4-byte frame header (and headroom),
 * chosen to keep encoded frames comfortably under common SCTP message-size limits.
 */
export const DEFAULT_CHUNK_SIZE = 16 * 1024 - 8

/** Default backpressure high-water mark (4 MiB): the sender pauses once buffered bytes exceed this. */
export const DEFAULT_HIGH_WATER_MARK = 4 * 1024 * 1024

/** Default backpressure low-water mark (256 KiB): a paused sender resumes once buffered bytes fall to this. */
export const DEFAULT_LOW_WATER_MARK = 256 * 1024

/** Default number of parallel data channels per transfer (single channel). */
export const DEFAULT_PARALLEL_CHANNELS = 1

/** Default offer-accept timeout (30 seconds) before a sender gives up on an unanswered offer. */
export const DEFAULT_OFFER_TIMEOUT_MS = 30_000

/**
 * Resolves partial tuning options into a complete {@link ResolvedTuning}, layering
 * `opts` over an optional `base` and finally over the module defaults.
 *
 * @param opts - Highest-priority overrides (for example per-send {@link SendOptions}).
 * @param base - Fallback values applied when `opts` omits a field (for example manager-level defaults).
 * @returns A {@link ResolvedTuning} with every field populated.
 */
export function resolveTuning(
    opts: TransferTuning & { checksum?: boolean; maxFileSize?: number; resumable?: boolean } = {},
    base: Partial<ResolvedTuning> = {},
): ResolvedTuning {
    return {
        chunkSize: opts.chunkSize ?? base.chunkSize ?? DEFAULT_CHUNK_SIZE,
        highWaterMark: opts.highWaterMark ?? base.highWaterMark ?? DEFAULT_HIGH_WATER_MARK,
        lowWaterMark: opts.lowWaterMark ?? base.lowWaterMark ?? DEFAULT_LOW_WATER_MARK,
        parallelChannels:
            opts.parallelChannels ?? base.parallelChannels ?? DEFAULT_PARALLEL_CHANNELS,
        checksum: opts.checksum ?? base.checksum ?? true,
        maxFileSize: opts.maxFileSize ?? base.maxFileSize,
        offerTimeoutMs: opts.offerTimeoutMs ?? base.offerTimeoutMs ?? DEFAULT_OFFER_TIMEOUT_MS,
        resumable: opts.resumable ?? base.resumable ?? false,
    }
}
