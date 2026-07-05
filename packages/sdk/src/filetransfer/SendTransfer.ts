import { Transfer } from './Transfer.js'
import { awaitDrain, waitForOpen } from './channel.js'
import { Sha256Digest } from './checksum.js'
import { FileTransferError, FileTransferErrorCode } from './errors.js'
import { encodeFrame } from './framing.js'
import { type ControlMessage, ControlType, FT_PROTOCOL_VERSION } from './protocol.js'
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
    /** Milliseconds to wait for the receiver to accept before failing; `0` disables. */
    offerTimeoutMs: number
    /** When `true`, a mid-transfer channel drop pauses (not fails) so the send can be resumed. */
    resumable: boolean
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
    private _channels: RTCDataChannel[]
    private readonly _sendControl: ControlSender
    private readonly _highWaterMark: number
    private readonly _lowWaterMark: number
    private readonly _checksum: boolean
    private readonly _resumable: boolean
    private readonly _offerTimeoutMs: number
    private _offerTimer: ReturnType<typeof setTimeout> | null = null
    private _resumeWaiters: Array<() => void> = []
    private _interrupted = false
    // A Pause that arrived while still in Accepted (before _run flips Accepted→Active
    // on a later microtask) is recorded here and honoured once _run reaches Active,
    // so it isn't silently dropped.
    private _pendingPause = false
    // Unique chunk seqs actually sent, so progress counters reflect unique chunks and
    // never exceed the total when a resume resends chunks.
    private readonly _sentSeqs = new Set<number>()
    // Monotonic run generation. Every `_run` loop captures the current value;
    // workers exit as soon as it changes, so a superseded run (duplicate accept,
    // resume, or terminal) can never send concurrently with the live one.
    private _gen = 0

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
        this._resumable = params.resumable
        this._offerTimeoutMs = params.offerTimeoutMs
    }

    /** Number of parallel data channels this transfer streams over. */
    get channelCount(): number {
        return this._channels.length
    }

    /** Whether this transfer is paused awaiting a {@link SendTransfer.reoffer} after a channel drop. */
    get interrupted(): boolean {
        return this._interrupted
    }

    /**
     * Re-announce this transfer on freshly reconnected data channels after an
     * interrupt. The receiver responds with a resume request so only the chunks
     * it is missing are resent. No-op unless the transfer was interrupted.
     *
     * @param channels - The new binary data channels to stream over.
     */
    reoffer(channels: RTCDataChannel[]): void {
        if (this.isTerminal || !this._interrupted) return
        // Close any channels from the previous set that aren't being reused, so a
        // partial drop (parallelChannels>1) or a double resumeSend() doesn't leak
        // still-open survivor channels. Channels that carry over stay open and are
        // closed exactly once by _onTerminal.
        const next = new Set(channels)
        for (const ch of this._channels) {
            if (next.has(ch)) continue
            try {
                ch.close()
            } catch {
                // already closing/closed
            }
        }
        this._channels = channels
        this._sendOffer()
        // Don't sit Paused forever if the re-offer is never answered: arm the same
        // offer-timeout window used by start(). Any control reply clears it (see
        // handleControl); a successful resume clears _interrupted so a late fire no-ops.
        this._armOfferTimeout(() => this._interrupted && !this.isTerminal)
    }

    private _sendOffer(): void {
        this._safeControl({
            type: ControlType.Offer,
            transferId: this.id,
            version: FT_PROTOCOL_VERSION,
            name: this.metadata.name,
            mimeType: this.metadata.mimeType,
            size: this.metadata.size,
            chunkSize: this.chunkSize,
            totalChunks: this.totalChunks,
            parallelChannels: this._channels.length,
            checksum: this._checksum,
        })
    }

    protected override _notifyRemoteFailure(error: FileTransferError): void {
        this._safeControl({ type: ControlType.Cancel, transferId: this.id, reason: error.message })
    }

    protected override _onTerminal(): void {
        this._clearOfferTimer()
        // Bump the generation so any worker still parked at the pause gate exits
        // when released instead of resuming a dead transfer.
        this._gen += 1
        // Release any worker suspended at the pause gate so it doesn't leak.
        const waiters = this._resumeWaiters
        this._resumeWaiters = []
        for (const w of waiters) w()
        // Close the per-transfer data channels so SCTP streams don't leak across
        // many transfers.
        for (const ch of this._channels) {
            try {
                ch.close()
            } catch {
                // already closing/closed
            }
        }
        // Release the source handle on EVERY terminal state (complete/fail/cancel),
        // not just cancel — otherwise a Node source leaks an fd on each send.
        void this._source.close?.()
    }

    /**
     * Begins the transfer by sending the offer control message to the receiver. Byte streaming
     * starts only after the receiver accepts (or requests a resume). Idempotent once past
     * {@link TransferState.Idle}. Called automatically by {@link FileTransferManager.sendFile}.
     */
    start(): void {
        if (!this.transitionTo(TransferState.Offered)) return
        this._sendOffer()
        // Don't sit in Offered forever holding open channels if the receiver
        // never answers. Fail (and notify) once the offer window elapses.
        // Guard: start() can self-fail via _safeControl above; don't arm a timer
        // on an already-terminal transfer.
        if (this._state === TransferState.Offered) {
            this._armOfferTimeout(() => this._state === TransferState.Offered)
        }
    }

    // Arm the offer-accept timeout window. When it elapses and `stillWaiting()` is
    // still true (offer never answered), fail the transfer and notify the peer.
    // No-op when the timeout is disabled. Unref'd so it never keeps the loop alive.
    private _armOfferTimeout(stillWaiting: () => boolean): void {
        this._clearOfferTimer()
        if (this._offerTimeoutMs <= 0) return
        const timer = setTimeout(() => {
            this._offerTimer = null
            if (stillWaiting()) {
                this.fail(
                    new FileTransferError(
                        'offer not accepted before timeout',
                        FileTransferErrorCode.Timeout,
                        { transferId: this.id },
                    ),
                    true,
                )
            }
        }, this._offerTimeoutMs)
        // Don't keep the Node event loop alive just for the offer window.
        ;(timer as { unref?: () => void }).unref?.()
        this._offerTimer = timer
    }

    private _clearOfferTimer(): void {
        if (this._offerTimer !== null) {
            clearTimeout(this._offerTimer)
            this._offerTimer = null
        }
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
        // Any control message from the receiver ends the "awaiting accept" window.
        this._clearOfferTimer()
        switch (msg.type) {
            case ControlType.Accept:
                this._begin(new Set(msg.haveChunks ?? []))
                break
            case ControlType.ResumeRequest:
                // haveChunks = what the receiver already has; the worker skips
                // those and sends the rest (same semantics as Accept). Passing the
                // complement here was an inverted bug in this previously-dead path.
                this._begin(new Set(msg.haveChunks))
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
        this._clearOfferTimer()
        if (this._state === TransferState.Offered) {
            if (!this.transitionTo(TransferState.Accepted)) return
        } else if (this._state === TransferState.Paused && this._interrupted) {
            // Reoffer resume: go back to Active for a fresh run on the reconnected
            // channels. The generation bump below makes any worker still parked
            // from the interrupted run exit when _applyResume releases it.
            this._interrupted = false
            if (!this._applyResume()) return
        } else {
            // Already Active/running, a user-pause, or any other state: ignore a
            // duplicate Accept / spurious ResumeRequest so we never spawn a second
            // concurrent worker set.
            return
        }
        // State is now Accepted (fresh) or Active (resume); _run transitions
        // Accepted→Active itself and bails if it isn't Active.
        const gen = ++this._gen
        this._run(haveChunks, gen).catch((err: unknown) => {
            // Ignore failures from a superseded run.
            if (gen !== this._gen) return
            const e = this.toTransferError(err, FileTransferErrorCode.SourceReadFailed)
            // When resumable, a channel dropping mid-transfer is recoverable:
            // pause (don't fail, don't cancel the receiver) and await a reoffer.
            if (
                this._resumable &&
                e.code === FileTransferErrorCode.ChannelClosed &&
                !this.isTerminal
            ) {
                this._interrupt()
                return
            }
            this.fail(e, true)
        })
    }

    // Suspend on a recoverable channel drop without notifying the receiver, so it
    // keeps its partial state and can drive a resume.
    private _interrupt(): void {
        if (this._state === TransferState.Active && this.transitionTo(TransferState.Paused)) {
            this._interrupted = true
        }
    }

    private async _run(haveChunks: Set<number>, gen: number): Promise<void> {
        if (this._state === TransferState.Accepted && !this.transitionTo(TransferState.Active)) {
            return
        }
        if (this._state !== TransferState.Active) return

        // Honour a Pause that arrived during the Accepted→Active window; the workers
        // will park at the pause gate instead of streaming past a paused receiver.
        if (this._pendingPause) {
            this._pendingPause = false
            this.transitionTo(TransferState.Paused)
        }

        const digest = this._checksum ? new Sha256Digest() : null
        await Promise.all(
            this._channels.map((ch, i) => this._worker(i, ch, haveChunks, digest, gen)),
        )
        // Bail if a newer run superseded this one (resume) or the transfer ended.
        if (this.isTerminal || gen !== this._gen) return
        const hex = digest ? await digest.finalize() : undefined
        this.transitionTo(TransferState.Completing)
        this._safeControl({ type: ControlType.Sent, transferId: this.id, digest: hex })
    }

    private async _worker(
        index: number,
        channel: RTCDataChannel,
        haveChunks: Set<number>,
        digest: Sha256Digest | null,
        gen: number,
    ): Promise<void> {
        const stride = this._channels.length
        await waitForOpen(channel, this.id)
        for (let seq = index; seq < this.totalChunks; seq += stride) {
            if (this.isTerminal || gen !== this._gen) return
            await this._pauseGate()
            if (this.isTerminal || gen !== this._gen) return
            const need = !haveChunks.has(seq)

            if (!need && !digest) continue

            const offset = seq * this.chunkSize
            const length = Math.min(this.chunkSize, this.metadata.size - offset)
            const bytes = new Uint8Array(await this._source.slice(offset, length))
            if (digest) await digest.update(seq, bytes)
            if (!need) continue

            await awaitDrain(channel, this._highWaterMark, this._lowWaterMark, this.id)
            if (this.isTerminal || gen !== this._gen) return
            if (channel.readyState !== 'open') {
                throw new FileTransferError(
                    `data channel '${channel.label}' closed mid-transfer`,
                    FileTransferErrorCode.ChannelClosed,
                    { transferId: this.id },
                )
            }
            channel.send(encodeFrame(seq, bytes))
            // Count each unique chunk once so a resume that resends chunks can't push
            // reported progress past the total.
            if (!this._sentSeqs.has(seq)) {
                this._sentSeqs.add(seq)
                this._transferredChunks += 1
                this._transferredBytes += length
            }
            this.emitProgress()
        }
    }

    private _applyPause(): boolean {
        // Accepted→Active happens on a later microtask in _run; record the pause so
        // it isn't dropped in that window (_run honours the flag when it goes Active).
        if (this._state === TransferState.Accepted) {
            this._pendingPause = true
            return true
        }
        if (this._state !== TransferState.Active) return false
        return this.transitionTo(TransferState.Paused)
    }

    private _applyResume(): boolean {
        // A resume that arrives in the same Accepted window simply cancels a recorded
        // pending pause; the transfer keeps heading to Active.
        if (this._state === TransferState.Accepted && this._pendingPause) {
            this._pendingPause = false
            return true
        }
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

    private _markCancelled(reason?: string): void {
        if (this.isTerminal) return
        this._clearOfferTimer()
        // transitionTo(Cancelled) triggers _onTerminal, which closes the source.
        this.transitionTo(TransferState.Cancelled)
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
