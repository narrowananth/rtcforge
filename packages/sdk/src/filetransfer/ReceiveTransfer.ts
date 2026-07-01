import type { ControlSender } from './SendTransfer.js'
import { Transfer } from './Transfer.js'
import { Sha256Digest } from './checksum.js'
import { FileTransferError, FileTransferErrorCode } from './errors.js'
import { decodeFrame, toArrayBuffer } from './framing.js'
import { type ControlMessage, ControlType } from './protocol.js'
import type { SinkResult, StorageSink } from './sink/StorageSink.js'
import { type FileMetadata, TransferDirection, TransferEvent, TransferState } from './types.js'

/** Construction parameters for a {@link ReceiveTransfer}, derived from the sender's offer. */
export interface ReceiveTransferParams {
    /** Transfer id from the offer. */
    id: string
    /** Identifier of the sending peer. */
    peerId: string
    /** File metadata advertised in the offer. */
    metadata: FileMetadata
    /** Payload bytes per chunk, as chosen by the sender. */
    chunkSize: number
    /** Total number of chunks expected. */
    totalChunks: number
    /** Whether the sender will provide a SHA-256 digest to verify against. */
    checksum: boolean
    /** Callback used to emit control messages (accept, reject, complete, …) to the sender. */
    sendControl: ControlSender
}

/**
 * A file transfer in the receiving direction.
 *
 * Created when a remote offer arrives (see {@link FileTransferEvent.IncomingOffer}). The
 * application inspects {@link ReceiveTransfer.metadata} and then calls {@link ReceiveTransfer.accept}
 * with a {@link StorageSink} — or {@link ReceiveTransfer.reject} to decline. Once accepted, framed
 * chunks arriving on the data channel(s) are decoded, deduplicated, hashed (when checksums are
 * enabled), and written to the sink at their byte offset. When the sender signals it is done and
 * every chunk has been received, the digest is verified, the sink is closed, and the resulting
 * {@link SinkResult} is exposed via {@link ReceiveTransfer.result}.
 *
 * @example
 * ```ts
 * manager.on('incoming-offer', (transfer) => {
 *     console.log(`incoming ${transfer.fileName} (${transfer.metadata.size} bytes)`)
 *     transfer.accept(new MemorySink())
 *     transfer.on('complete', () => {
 *         const blob = transfer.result?.blob
 *     })
 * })
 * ```
 */
export class ReceiveTransfer extends Transfer {
    /** Always {@link TransferDirection.Receive}. */
    readonly direction = TransferDirection.Receive

    private readonly _sendControl: ControlSender
    private readonly _checksum: boolean
    private readonly _received = new Set<number>()
    private readonly _channels = new Set<RTCDataChannel>()
    private _sink: StorageSink | null = null
    private _digest: Sha256Digest | null = null
    private _expectedDigest: string | undefined
    private _senderDone = false
    private _writeChain: Promise<void> = Promise.resolve()
    private _result: SinkResult | null = null

    /**
     * @param params - Offer-derived parameters; see {@link ReceiveTransferParams}. The transfer
     *   starts in {@link TransferState.Offered}, awaiting {@link ReceiveTransfer.accept}.
     */
    constructor(params: ReceiveTransferParams) {
        super({
            id: params.id,
            peerId: params.peerId,
            metadata: params.metadata,
            chunkSize: params.chunkSize,
            totalChunks: params.totalChunks,
        })
        this._sendControl = params.sendControl
        this._checksum = params.checksum
        this.transitionTo(TransferState.Offered)
    }

    /** Convenience accessor for the offered file name (equivalent to `metadata.name`). */
    get fileName(): string {
        return this.metadata.name
    }

    /**
     * The sink's finalized output (blob, byte array, and/or path), or `null` until the transfer
     * reaches {@link TransferState.Completed}.
     */
    get result(): SinkResult | null {
        return this._result
    }

    /**
     * Accepts the offer and begins receiving into `sink`.
     *
     * Opens the sink, transitions the transfer to active, and sends an accept control message
     * (including any chunks already buffered, to support resume). If the transfer is not in
     * {@link TransferState.Offered}, or the sink fails to open, the transfer fails instead.
     *
     * @param sink - Destination the received bytes are written to (for example {@link MemorySink}).
     */
    accept(sink: StorageSink): void {
        if (this._state !== TransferState.Offered) {
            this.fail(
                new FileTransferError(
                    `cannot accept transfer in state '${this._state}'`,
                    FileTransferErrorCode.InvalidState,
                    { transferId: this.id },
                ),
            )
            return
        }
        this._sink = sink
        this._digest = this._checksum ? new Sha256Digest() : null
        this.transitionTo(TransferState.Accepted)
        Promise.resolve(sink.open?.(this.metadata))
            .then(() => {
                this.transitionTo(TransferState.Active)
                this._sendControl({
                    type: ControlType.Accept,
                    transferId: this.id,
                    haveChunks: [...this._received],
                })
            })
            .catch((err: unknown) => {
                this.fail(this.toTransferError(err, FileTransferErrorCode.SinkWriteFailed))
            })
    }

    /**
     * Declines the offer, notifying the sender. No-op unless the transfer is
     * {@link TransferState.Offered}.
     *
     * @param reason - Optional human-readable reason relayed to the sender.
     */
    reject(reason?: string): void {
        if (this._state !== TransferState.Offered) return
        this._sendControl({ type: ControlType.Reject, transferId: this.id, reason })
        this.transitionTo(TransferState.Cancelled)
    }

    /**
     * Binds an inbound binary data channel to this transfer and starts consuming framed chunks
     * from it. Called by {@link FileTransferManager} as the sender's parallel channels open; may
     * be invoked multiple times (once per parallel channel).
     *
     * @param channel - The data channel carrying framed chunk payloads for this transfer.
     */
    attachChannel(channel: RTCDataChannel): void {
        channel.binaryType = 'arraybuffer'
        this._channels.add(channel)
        channel.addEventListener('message', (ev: MessageEvent) => {
            void this._onMessage(ev.data)
        })
    }

    /**
     * Processes an inbound control message from the sender. A `sent` message records the
     * sender-computed digest and marks the stream complete (triggering finalization once all
     * chunks have arrived); a `cancel` aborts the transfer. Routed here by {@link FileTransferManager}.
     *
     * @param msg - The decoded control message.
     */
    handleControl(msg: ControlMessage): void {
        switch (msg.type) {
            case ControlType.Sent:
                this._senderDone = true
                this._expectedDigest = msg.digest
                void this._tryComplete()
                break
            case ControlType.Cancel:
                this._markCancelled(msg.reason)
                break
        }
    }

    /**
     * Requests that the sender pause streaming and notifies it. No-op unless the transfer is
     * {@link TransferState.Active}.
     */
    pause(): void {
        if (this._state === TransferState.Active) {
            this.transitionTo(TransferState.Paused)
            this._sendControl({ type: ControlType.Pause, transferId: this.id })
        }
    }

    /**
     * Requests that the sender resume streaming and notifies it. No-op unless the transfer is
     * {@link TransferState.Paused}.
     */
    resume(): void {
        if (this._state === TransferState.Paused) {
            this.transitionTo(TransferState.Active)
            this._sendControl({ type: ControlType.Resume, transferId: this.id })
        }
    }

    /**
     * Cancels the transfer, notifying the sender and aborting the sink. No-op if already terminal.
     *
     * @param reason - Optional reason; when provided, surfaced via {@link TransferEvent.Error}.
     */
    cancel(reason?: string): void {
        if (this.isTerminal) return
        this._sendControl({ type: ControlType.Cancel, transferId: this.id, reason })
        this._markCancelled(reason)
    }

    private async _onMessage(data: unknown): Promise<void> {
        if (this.isTerminal || !this._sink) return
        let seq: number
        let payload: Uint8Array
        try {
            const buf = await toArrayBuffer(data)
            const frame = decodeFrame(buf)
            seq = frame.seq
            payload = frame.payload
        } catch (err) {
            this.fail(this.toTransferError(err, FileTransferErrorCode.InvalidFrame))
            return
        }
        if (this._received.has(seq)) return

        this._received.add(seq)
        const bytes = payload.slice()
        this._transferredChunks += 1
        this._transferredBytes += bytes.byteLength
        this.emitProgress()

        this._enqueueChunk(seq, bytes)
        void this._tryComplete()
    }

    private _enqueueChunk(seq: number, bytes: Uint8Array): void {
        const sink = this._sink
        if (!sink) return
        this._writeChain = this._writeChain.then(async () => {
            if (this.isTerminal) return
            try {
                if (this._digest) await this._digest.update(seq, bytes)
                await sink.write(seq * this.chunkSize, bytes)
            } catch (err) {
                this.fail(this.toTransferError(err, FileTransferErrorCode.SinkWriteFailed))
                await sink.abort(err)
            }
        })
    }

    private async _tryComplete(): Promise<void> {
        if (this.isTerminal || !this._sink) return
        if (!this._senderDone) return
        if (this._received.size < this.totalChunks) return

        await this._writeChain
        if (this.isTerminal) return

        if (this._digest) {
            const local = await this._digest.finalize()
            if (this._expectedDigest !== undefined && local !== this._expectedDigest) {
                this._sendControl({ type: ControlType.ChecksumMismatch, transferId: this.id })
                await this._sink.abort('checksum mismatch')
                this.fail(
                    new FileTransferError(
                        'checksum mismatch on received file',
                        FileTransferErrorCode.ChecksumMismatch,
                        { transferId: this.id },
                    ),
                )
                return
            }
        }

        this.transitionTo(TransferState.Completing)
        try {
            this._result = await this._sink.close()
        } catch (err) {
            this.fail(this.toTransferError(err, FileTransferErrorCode.SinkWriteFailed))
            return
        }
        this._sendControl({ type: ControlType.Complete, transferId: this.id })
        if (this.transitionTo(TransferState.Completed)) {
            this.emit(TransferEvent.Complete, this.id)
        }
    }

    private _markCancelled(reason?: string): void {
        if (this.isTerminal) return
        this.transitionTo(TransferState.Cancelled)
        void this._sink?.abort(reason)
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
}
