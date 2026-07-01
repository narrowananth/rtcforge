import { Transfer } from './Transfer.js'
import { awaitDrain, waitForOpen } from './channel.js'
import { Sha256Digest } from './checksum.js'
import { FileTransferError, FileTransferErrorCode } from './errors.js'
import { encodeFrame } from './framing.js'
import { type ControlMessage, ControlType } from './protocol.js'
import type { FileSource } from './source/FileSource.js'
import { type FileMetadata, TransferDirection, TransferEvent, TransferState } from './types.js'

/** Callback that delivers a {@link ControlMessage} to the remote peer over the control channel. */
export type ControlSender = (msg: ControlMessage) => void

/** Construction parameters for a {@link SendTransfer}, assembled by {@link FileTransferManager.sendFile}. */
export interface SendTransferParams {
    /** Unique transfer id shared with the remote peer. */
    id: string
    /** Identifier of the receiving peer. */
    peerId: string
    /** Source the file bytes are read from. */
    source: FileSource
    /** Binary data channels (one per parallel channel) that chunks are striped across. */
    channels: RTCDataChannel[]
    /** Callback used to emit control messages (offer, sent, cancel, …) to the peer. */
    sendControl: ControlSender
    /** Payload bytes per chunk. */
    chunkSize: number
    /** Backpressure high-water mark in bytes. */
    highWaterMark: number
    /** Backpressure low-water mark in bytes. */
    lowWaterMark: number
    /** Whether to compute and send a SHA-256 digest for receiver verification. */
    checksum: boolean
}

/**
 * A file transfer in the sending direction.
 *
 * Announces the file to the receiver with an offer control message, then — once accepted —
 * reads the source in {@link SendTransferParams.chunkSize} chunks and streams them as framed
 * binary messages across one or more data channels. Chunks are striped round-robin across the
 * channels, backpressure is applied via each channel's `bufferedAmount` (see the high/low water
 * marks), and when checksums are enabled a SHA-256 digest is computed over the file and sent so
 * the receiver can verify integrity. Supports pause/resume and cancellation, and honours a
 * receiver's resume request by resending only the chunks it is missing.
 *
 * @remarks
 * Instances are created and started by {@link FileTransferManager.sendFile}; construct via the
 * manager rather than directly.
 *
 * @example
 * ```ts
 * const transfer = manager.sendFile(peerId, file)
 * transfer.on('progress', (p) => console.log(`${Math.round(p.ratio * 100)}%`))
 * transfer.on('complete', () => console.log('sent'))
 * transfer.on('error', (err) => console.error(err.code, err.message))
 * ```
 */
export class SendTransfer extends Transfer {
    /** Always {@link TransferDirection.Send}. */
    readonly direction = TransferDirection.Send

    private readonly _source: FileSource
    private readonly _channels: RTCDataChannel[]
    private readonly _sendControl: ControlSender
    private readonly _highWaterMark: number
    private readonly _lowWaterMark: number
    private readonly _checksum: boolean
    private _resumeWaiters: Array<() => void> = []

    /**
     * @param params - Fully-resolved send parameters; see {@link SendTransferParams}.
     */
    constructor(params: SendTransferParams) {
        const metadata: FileMetadata = {
            name: params.source.name,
            mimeType: params.source.mimeType,
            size: params.source.size,
        }
        const totalChunks = Math.ceil(metadata.size / params.chunkSize)
        super({
            id: params.id,
            peerId: params.peerId,
            metadata,
            chunkSize: params.chunkSize,
            totalChunks,
        })
        this._source = params.source
        this._channels = params.channels
        this._sendControl = params.sendControl
        this._highWaterMark = params.highWaterMark
        this._lowWaterMark = params.lowWaterMark
        this._checksum = params.checksum
    }

    /**
     * Begins the transfer by sending the offer control message to the receiver. Byte streaming
     * starts only after the receiver accepts (or requests a resume). Idempotent once past
     * {@link TransferState.Idle}. Called automatically by {@link FileTransferManager.sendFile}.
     */
    start(): void {
        if (!this.transitionTo(TransferState.Offered)) return
        this._safeControl({
            type: ControlType.Offer,
            transferId: this.id,
            name: this.metadata.name,
            mimeType: this.metadata.mimeType,
            size: this.metadata.size,
            chunkSize: this.chunkSize,
            totalChunks: this.totalChunks,
            parallelChannels: this._channels.length,
            checksum: this._checksum,
        })
    }

    /**
     * Processes an inbound control message from the receiver, driving the send state machine:
     * accept/resume-request begin streaming (the latter resending only the receiver's missing
     * chunks), reject/checksum-mismatch fail the transfer, complete finalizes it, and
     * pause/resume/cancel are applied. Routed here by {@link FileTransferManager}.
     *
     * @param msg - The decoded control message.
     */
    handleControl(msg: ControlMessage): void {
        switch (msg.type) {
            case ControlType.Accept:
                this._begin(new Set(msg.haveChunks ?? []))
                break
            case ControlType.ResumeRequest:
                this._begin(this._complement(new Set(msg.haveChunks)))
                break
            case ControlType.Reject:
                this.fail(
                    new FileTransferError(
                        `offer rejected${msg.reason ? `: ${msg.reason}` : ''}`,
                        FileTransferErrorCode.OfferRejected,
                        { transferId: this.id },
                    ),
                )
                break
            case ControlType.Complete:
                if (this.transitionTo(TransferState.Completed)) {
                    this.emit(TransferEvent.Complete, this.id)
                }
                break
            case ControlType.ChecksumMismatch:
                this.fail(
                    new FileTransferError(
                        'receiver reported a checksum mismatch',
                        FileTransferErrorCode.ChecksumMismatch,
                        { transferId: this.id },
                    ),
                )
                break
            case ControlType.Pause:
                this._applyPause()
                break
            case ControlType.Resume:
                this._applyResume()
                break
            case ControlType.Cancel:
                this._markCancelled(msg.reason)
                break
        }
    }

    /**
     * Suspends streaming and notifies the receiver. No-op unless the transfer is
     * {@link TransferState.Active}. In-flight chunk reads stop at the next pause gate.
     */
    pause(): void {
        if (this._applyPause()) {
            this._safeControl({ type: ControlType.Pause, transferId: this.id })
        }
    }

    /**
     * Resumes a paused transfer and notifies the receiver, releasing workers waiting at the
     * pause gate. No-op unless the transfer is {@link TransferState.Paused}.
     */
    resume(): void {
        if (this._applyResume()) {
            this._safeControl({ type: ControlType.Resume, transferId: this.id })
        }
    }

    /**
     * Cancels the transfer, sending a cancel control message to the receiver and closing the
     * source. No-op if the transfer is already terminal.
     *
     * @param reason - Optional reason; when provided, surfaced via {@link TransferEvent.Error}.
     */
    cancel(reason?: string): void {
        if (this.isTerminal) return
        this._safeControl({ type: ControlType.Cancel, transferId: this.id, reason })
        this._markCancelled(reason)
    }

    private _begin(haveChunks: Set<number>): void {
        if (this._state === TransferState.Offered && !this.transitionTo(TransferState.Accepted)) {
            return
        }
        this._run(haveChunks).catch((err: unknown) => {
            this.fail(this.toTransferError(err, FileTransferErrorCode.SourceReadFailed))
        })
    }

    private async _run(haveChunks: Set<number>): Promise<void> {
        if (this._state === TransferState.Accepted && !this.transitionTo(TransferState.Active)) {
            return
        }

        const digest = this._checksum ? new Sha256Digest() : null
        await Promise.all(this._channels.map((ch, i) => this._worker(i, ch, haveChunks, digest)))
        if (this.isTerminal) return
        const hex = digest ? await digest.finalize() : undefined
        this.transitionTo(TransferState.Completing)
        this._safeControl({ type: ControlType.Sent, transferId: this.id, digest: hex })
    }

    private async _worker(
        index: number,
        channel: RTCDataChannel,
        haveChunks: Set<number>,
        digest: Sha256Digest | null,
    ): Promise<void> {
        const stride = this._channels.length
        await waitForOpen(channel, this.id)
        for (let seq = index; seq < this.totalChunks; seq += stride) {
            if (this.isTerminal) return
            await this._pauseGate()
            if (this.isTerminal) return
            const need = !haveChunks.has(seq)

            if (!need && !digest) continue

            const offset = seq * this.chunkSize
            const length = Math.min(this.chunkSize, this.metadata.size - offset)
            const bytes = new Uint8Array(await this._source.slice(offset, length))
            if (digest) await digest.update(seq, bytes)
            if (!need) continue

            await awaitDrain(channel, this._highWaterMark, this._lowWaterMark)
            if (this.isTerminal) return
            if (channel.readyState !== 'open') {
                throw new FileTransferError(
                    `data channel '${channel.label}' closed mid-transfer`,
                    FileTransferErrorCode.ChannelClosed,
                    { transferId: this.id },
                )
            }
            channel.send(encodeFrame(seq, bytes))
            this._transferredChunks += 1
            this._transferredBytes += length
            this.emitProgress()
        }
    }

    private _applyPause(): boolean {
        if (this._state !== TransferState.Active) return false
        return this.transitionTo(TransferState.Paused)
    }

    private _applyResume(): boolean {
        if (this._state !== TransferState.Paused) return false
        if (!this.transitionTo(TransferState.Active)) return false
        const waiters = this._resumeWaiters
        this._resumeWaiters = []
        for (const w of waiters) w()
        return true
    }

    private _pauseGate(): Promise<void> {
        if (this._state !== TransferState.Paused) return Promise.resolve()
        return new Promise<void>((resolve) => this._resumeWaiters.push(resolve))
    }

    private _complement(have: Set<number>): Set<number> {
        const missing = new Set<number>()
        for (let seq = 0; seq < this.totalChunks; seq += 1) {
            if (!have.has(seq)) missing.add(seq)
        }
        return missing
    }

    private _markCancelled(reason?: string): void {
        if (this.isTerminal) return
        this.transitionTo(TransferState.Cancelled)
        void this._source.close?.()
        if (reason !== undefined) {
            this.emit(
                TransferEvent.Error,
                new FileTransferError(
                    `transfer cancelled: ${reason}`,
                    FileTransferErrorCode.Cancelled,
                    { transferId: this.id },
                ),
            )
        }
    }

    private _safeControl(msg: ControlMessage): void {
        try {
            this._sendControl(msg)
        } catch (err) {
            this.fail(this.toTransferError(err, FileTransferErrorCode.ChannelClosed))
        }
    }
}
