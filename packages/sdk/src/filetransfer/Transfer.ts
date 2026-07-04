import { EventEmitter } from 'rtcforge-core'
import { FileTransferError, type FileTransferErrorCode } from './errors.js'
import {
    type FileMetadata,
    type TransferDirection,
    TransferEvent,
    type TransferProgress,
    TransferState,
} from './types.js'

/**
 * Event map for {@link Transfer} (and its {@link SendTransfer} / {@link ReceiveTransfer}
 * subclasses), mapping each {@link TransferEvent} to its listener argument tuple.
 */
export type TransferEvents = {
    /** State transition: the new state followed by the previous one. */
    [TransferEvent.StateChanged]: [state: TransferState, previous: TransferState]
    /** Progress update carrying the latest {@link TransferProgress} snapshot. */
    [TransferEvent.Progress]: [progress: TransferProgress]
    /** Successful completion, carrying the transfer id. */
    [TransferEvent.Complete]: [transferId: string]
    /** Failure or reasoned cancellation, carrying the {@link FileTransferError}. */
    [TransferEvent.Error]: [error: FileTransferError]
}

const LEGAL_TRANSITIONS: Record<TransferState, readonly TransferState[]> = {
    [TransferState.Idle]: [TransferState.Offered],
    [TransferState.Offered]: [TransferState.Accepted],
    [TransferState.Accepted]: [TransferState.Active],
    [TransferState.Active]: [TransferState.Paused, TransferState.Completing],
    [TransferState.Paused]: [TransferState.Active],
    [TransferState.Completing]: [TransferState.Completed],
    [TransferState.Completed]: [],
    [TransferState.Failed]: [],
    [TransferState.Cancelled]: [],
}

const TERMINAL: readonly TransferState[] = [
    TransferState.Completed,
    TransferState.Failed,
    TransferState.Cancelled,
]

/**
 * Base class for a single file transfer in either direction.
 *
 * Owns the identity and metadata of a transfer, tracks byte/chunk progress, and
 * enforces the {@link TransferState} state machine (see the legal-transition table),
 * emitting {@link TransferEvent}s as it advances. Concrete behavior lives in the
 * {@link SendTransfer} and {@link ReceiveTransfer} subclasses.
 *
 * @remarks
 * Failure and cancellation are always reachable from any non-terminal state; the
 * ordinary lifecycle otherwise proceeds
 * idle → offered → accepted → active (⇄ paused) → completing → completed.
 */
export abstract class Transfer extends EventEmitter<TransferEvents> {
    /** Unique identifier shared by both peers for this transfer. */
    readonly id: string
    /** Identifier of the remote peer participating in this transfer. */
    readonly peerId: string
    /** Name, MIME type, and size of the file being transferred. */
    readonly metadata: FileMetadata
    /** Whether the local peer is sending or receiving; set by the concrete subclass. */
    abstract readonly direction: TransferDirection

    /** Total number of chunks the file is divided into. */
    protected readonly totalChunks: number
    /** Payload bytes per chunk. */
    protected readonly chunkSize: number
    /** Current lifecycle state. */
    protected _state: TransferState = TransferState.Idle
    /** Bytes transferred so far. */
    protected _transferredBytes = 0
    /** Chunks transferred so far. */
    protected _transferredChunks = 0

    /**
     * @param params - Transfer identity and chunking parameters.
     * @param params.id - Unique transfer id shared with the remote peer.
     * @param params.peerId - Remote peer identifier.
     * @param params.metadata - File name, MIME type, and size.
     * @param params.chunkSize - Payload bytes per chunk.
     * @param params.totalChunks - Number of chunks the file is split into.
     */
    constructor(params: {
        id: string
        peerId: string
        metadata: FileMetadata
        chunkSize: number
        totalChunks: number
    }) {
        super()
        this.id = params.id
        this.peerId = params.peerId
        this.metadata = params.metadata
        this.chunkSize = params.chunkSize
        this.totalChunks = params.totalChunks
    }

    /** The current lifecycle state of the transfer. */
    get state(): TransferState {
        return this._state
    }

    /** `true` once the transfer has reached a terminal state (completed, failed, or cancelled). */
    get isTerminal(): boolean {
        return TERMINAL.includes(this._state)
    }

    /**
     * Aborts the transfer, notifying the remote peer.
     *
     * @param reason - Optional human-readable reason surfaced to both peers.
     */
    abstract cancel(reason?: string): void

    /**
     * Returns a point-in-time {@link TransferProgress} snapshot.
     *
     * @returns Current byte/chunk counts and completion ratio (ratio is `0` for zero-byte files).
     */
    progress(): TransferProgress {
        const total = this.metadata.size
        return {
            transferId: this.id,
            transferredBytes: this._transferredBytes,
            totalBytes: total,
            ratio: total > 0 ? Math.min(1, this._transferredBytes / total) : 0,
            transferredChunks: this._transferredChunks,
            totalChunks: this.totalChunks,
        }
    }

    /** Emits a {@link TransferEvent.Progress} event with the current snapshot. */
    protected emitProgress(): void {
        this.emit(TransferEvent.Progress, this.progress())
    }

    /**
     * Attempts a state transition, enforcing the legal-transition table.
     *
     * @param next - The state to move to.
     * @returns `true` if the transition occurred (or was a no-op because already in `next`);
     *   `false` if the transfer is already terminal or the transition is illegal. Transitions to
     *   {@link TransferState.Failed} and {@link TransferState.Cancelled} are always permitted from
     *   any non-terminal state.
     */
    protected transitionTo(next: TransferState): boolean {
        if (this._state === next) return true
        const forcedTerminal = next === TransferState.Failed || next === TransferState.Cancelled
        if (this.isTerminal) return false
        if (!forcedTerminal && !LEGAL_TRANSITIONS[this._state].includes(next)) {
            return false
        }
        const previous = this._state
        this._state = next
        this.emit(TransferEvent.StateChanged, next, previous)
        if (TERMINAL.includes(next)) this._onTerminal()
        return true
    }

    /**
     * Hook invoked once when the transfer first reaches a terminal state
     * (completed/failed/cancelled). Subclasses override it to release resources —
     * close per-transfer data channels, drain any suspended workers, clear timers.
     */
    protected _onTerminal(): void {}

    /**
     * Transitions the transfer to {@link TransferState.Failed} and emits {@link TransferEvent.Error}.
     * No-op if the transfer is already terminal.
     *
     * @param error - The error describing the failure.
     * @returns The same `error`, for convenient `throw`/`return` chaining.
     */
    protected fail(error: FileTransferError, notifyRemote = false): FileTransferError {
        if (!this.isTerminal) {
            this.transitionTo(TransferState.Failed)
            // A purely local failure (disk full, source read error, bad frame)
            // must tell the peer, or the other side waits forever. Remote-initiated
            // failures (reject, checksum-mismatch, remote cancel) pass false.
            if (notifyRemote) this._notifyRemoteFailure(error)
            this.emit(TransferEvent.Error, error)
        }
        return error
    }

    /**
     * Hook invoked by {@link Transfer.fail} when a local failure must be signalled
     * to the remote peer. Overridden by the concrete subclasses to send a cancel
     * over the control channel; a no-op by default.
     */
    protected _notifyRemoteFailure(_error: FileTransferError): void {}

    /**
     * Normalizes an unknown thrown value into a {@link FileTransferError} tagged with this
     * transfer's id, passing through existing {@link FileTransferError}s unchanged.
     *
     * @param err - The caught value.
     * @param code - The {@link FileTransferErrorCode} to assign when wrapping.
     * @param message - Optional override message; otherwise derived from `err`.
     * @returns A {@link FileTransferError} suitable for {@link Transfer.fail}.
     */
    protected toTransferError(
        err: unknown,
        code: FileTransferErrorCode,
        message?: string,
    ): FileTransferError {
        if (err instanceof FileTransferError) return err
        const msg =
            message ?? (err instanceof Error ? err.message : `file transfer failed: ${String(err)}`)
        return new FileTransferError(msg, code, { cause: err, transferId: this.id })
    }
}
