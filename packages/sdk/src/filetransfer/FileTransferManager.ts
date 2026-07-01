import { EventEmitter, randomId, toError } from 'rtcforge-core'
import { ControlLink } from './ControlLink.js'
import { ReceiveTransfer } from './ReceiveTransfer.js'
import { SendTransfer } from './SendTransfer.js'
import type { Transfer } from './Transfer.js'
import { FileTransferError, FileTransferErrorCode } from './errors.js'
import {
    CONTROL_CHANNEL_LABEL,
    type ControlMessage,
    ControlMessageSchema,
    ControlType,
    dataChannelLabel,
    parseDataChannelLabel,
} from './protocol.js'
import { BlobFileSource } from './source/BlobFileSource.js'
import type { FileSource } from './source/FileSource.js'
import {
    type DataChannelHub,
    FileTransferEvent,
    type FileTransferOptions,
    type ResolvedTuning,
    type SendOptions,
    TransferEvent,
    resolveTuning,
} from './types.js'

/**
 * Accepted input to {@link FileTransferManager.sendFile}: a browser {@link File}/{@link Blob}
 * (wrapped in a {@link BlobFileSource}) or any custom {@link FileSource} (for example a
 * Node-backed source).
 */
export type SendInput = FileSource | Blob | File

/** Event map for {@link FileTransferManager}. */
export type FileTransferManagerEvents = {
    /** A remote peer offered a file; the payload is a not-yet-accepted {@link ReceiveTransfer}. */
    [FileTransferEvent.IncomingOffer]: [transfer: ReceiveTransfer]
    /** A manager-level error occurred (for example an unparseable control message). */
    [FileTransferEvent.Error]: [error: FileTransferError]
}

interface PeerControl {
    out?: ControlLink

    in?: ControlLink
}

/**
 * Entry point for peer-to-peer file transfer over WebRTC data channels.
 *
 * Wraps a {@link DataChannelHub} and orchestrates both directions of transfer. For each peer it
 * maintains a single JSON control channel (labelled {@link CONTROL_CHANNEL_LABEL}) carrying the
 * offer/accept/complete/cancel handshake, and opens per-transfer binary channels for the framed
 * chunk data. Outbound transfers are started with {@link FileTransferManager.sendFile}; inbound
 * offers surface as {@link FileTransferEvent.IncomingOffer} events carrying a {@link ReceiveTransfer}
 * the application accepts or rejects. The manager routes inbound control messages and data channels
 * to the right {@link Transfer}, buffering data channels that arrive before their offer.
 *
 * @remarks
 * The manager does not create or negotiate `RTCPeerConnection`s itself — that is the hub's job.
 * Completed, failed, and cancelled transfers are automatically removed from the manager's registry.
 *
 * @example
 * ```ts
 * const manager = new FileTransferManager(hub, { parallelChannels: 4 })
 *
 * // Sending
 * const send = manager.sendFile(peerId, file)
 * send.on('progress', (p) => console.log(p.ratio))
 *
 * // Receiving
 * manager.on('incoming-offer', (transfer) => {
 *     transfer.accept(new MemorySink())
 * })
 * ```
 */
export class FileTransferManager extends EventEmitter<FileTransferManagerEvents> {
    private readonly _hub: DataChannelHub
    private readonly _tuning: ResolvedTuning
    private readonly _transfers = new Map<string, Transfer>()
    private readonly _control = new Map<string, PeerControl>()

    private readonly _pendingChannels = new Map<string, RTCDataChannel[]>()
    private readonly _onHubChannel: (peerId: string, channel: RTCDataChannel) => void
    private _closed = false

    /**
     * @param hub - The data-channel hub used to open outbound channels and observe inbound ones.
     * @param options - Default tuning and checksum settings applied to every transfer; see
     *   {@link FileTransferOptions}. Per-send overrides are passed to {@link FileTransferManager.sendFile}.
     */
    constructor(hub: DataChannelHub, options: FileTransferOptions = {}) {
        super()
        this._hub = hub
        this._tuning = resolveTuning(options)
        this._onHubChannel = (peerId, channel) => this._handleInboundChannel(peerId, channel)
        hub.on('data-channel', this._onHubChannel)
    }

    /**
     * Offers a file to a peer and begins the send.
     *
     * Opens {@link SendOptions.parallelChannels | parallelChannels} binary data channels to the
     * peer, wraps `input` in a {@link FileSource}, and returns a started {@link SendTransfer}.
     * Actual byte streaming begins once the receiver accepts the offer.
     *
     * @param peerId - Identifier of the peer to send to; must have an active connection in the hub.
     * @param input - The file to send: a {@link File}, {@link Blob}, or custom {@link FileSource}.
     * @param opts - Optional per-transfer overrides merged over the manager defaults; see {@link SendOptions}.
     * @returns The {@link SendTransfer}; subscribe to its events to track progress and completion.
     * @throws {@link FileTransferError} with code `InvalidState` if the manager is closed, or
     *   `ChannelClosed` if there is no connection to `peerId`.
     *
     * @example
     * ```ts
     * const transfer = manager.sendFile('peer-42', file, { chunkSize: 32 * 1024, checksum: true })
     * transfer.on('complete', () => console.log('done'))
     * ```
     */
    sendFile(peerId: string, input: SendInput, opts: SendOptions = {}): SendTransfer {
        if (this._closed) {
            throw new FileTransferError(
                'FileTransferManager is closed',
                FileTransferErrorCode.InvalidState,
            )
        }
        const tuning = resolveTuning(opts, this._tuning)
        const source = this._toSource(input)
        const id = opts.transferId ?? randomId.next()

        const channels: RTCDataChannel[] = []
        for (let i = 0; i < tuning.parallelChannels; i += 1) {
            const ch = this._hub.createDataChannel(peerId, dataChannelLabel(id, i), {
                ordered: true,
            })
            if (!ch) {
                throw new FileTransferError(
                    `no connection to peer '${peerId}'`,
                    FileTransferErrorCode.ChannelClosed,
                    { transferId: id },
                )
            }
            ch.binaryType = 'arraybuffer'
            channels.push(ch)
        }

        const transfer = new SendTransfer({
            id,
            peerId,
            source,
            channels,
            sendControl: (msg) => this._sendControl(peerId, msg),
            chunkSize: tuning.chunkSize,
            highWaterMark: tuning.highWaterMark,
            lowWaterMark: tuning.lowWaterMark,
            checksum: tuning.checksum,
        })
        this._register(transfer)
        transfer.start()
        return transfer
    }

    /**
     * Returns all currently-tracked transfers in both directions.
     *
     * @returns A snapshot array of active {@link Transfer}s (terminal transfers are already removed).
     */
    transfers(): Transfer[] {
        return [...this._transfers.values()]
    }

    /**
     * Looks up a tracked transfer by id.
     *
     * @param id - The transfer id.
     * @returns The {@link Transfer}, or `undefined` if unknown or already terminal.
     */
    getTransfer(id: string): Transfer | undefined {
        return this._transfers.get(id)
    }

    /**
     * Shuts down the manager: detaches from the hub, cancels every in-flight transfer, and closes
     * all control channels. Idempotent. After closing, {@link FileTransferManager.sendFile} throws.
     */
    close(): void {
        if (this._closed) return
        this._closed = true
        this._hub.off('data-channel', this._onHubChannel)
        for (const t of this._transfers.values()) t.cancel('manager closed')
        this._transfers.clear()
        for (const pc of this._control.values()) {
            pc.out?.close()
            pc.in?.close()
        }
        this._control.clear()
        this._pendingChannels.clear()
    }

    private _register(transfer: Transfer): void {
        this._transfers.set(transfer.id, transfer)
        transfer.on(TransferEvent.StateChanged, (state) => {
            if (state === 'completed' || state === 'failed' || state === 'cancelled') {
                this._transfers.delete(transfer.id)
            }
        })
    }

    private _handleInboundChannel(peerId: string, channel: RTCDataChannel): void {
        if (channel.label === CONTROL_CHANNEL_LABEL) {
            const link = new ControlLink(channel, (raw) => this._onControlRaw(peerId, raw))
            this._peerControl(peerId).in = link
            return
        }
        const parsed = parseDataChannelLabel(channel.label)
        if (!parsed) return
        const transfer = this._transfers.get(parsed.transferId)
        if (transfer instanceof ReceiveTransfer) {
            transfer.attachChannel(channel)
        } else {
            const list = this._pendingChannels.get(parsed.transferId) ?? []
            list.push(channel)
            this._pendingChannels.set(parsed.transferId, list)
        }
    }

    private _onControlRaw(peerId: string, raw: unknown): void {
        let parsed: unknown
        try {
            parsed = JSON.parse(String(raw))
        } catch (err) {
            this.emit(FileTransferEvent.Error, this._wrap(err))
            return
        }
        const result = ControlMessageSchema.safeParse(parsed)
        if (!result.success) return
        this._routeControl(peerId, result.data)
    }

    private _routeControl(peerId: string, msg: ControlMessage): void {
        if (msg.type === ControlType.Offer) {
            if (this._transfers.has(msg.transferId)) return
            const transfer = new ReceiveTransfer({
                id: msg.transferId,
                peerId,
                metadata: { name: msg.name, mimeType: msg.mimeType, size: msg.size },
                chunkSize: msg.chunkSize,
                totalChunks: msg.totalChunks,
                checksum: msg.checksum,
                sendControl: (m) => this._sendControl(peerId, m),
            })
            this._register(transfer)

            const pending = this._pendingChannels.get(msg.transferId)
            if (pending) {
                for (const ch of pending) transfer.attachChannel(ch)
                this._pendingChannels.delete(msg.transferId)
            }
            this.emit(FileTransferEvent.IncomingOffer, transfer)
            return
        }

        const transfer = this._transfers.get(msg.transferId)
        if (!transfer) return
        if (transfer instanceof SendTransfer || transfer instanceof ReceiveTransfer) {
            transfer.handleControl(msg)
        }
    }

    private _sendControl(peerId: string, msg: ControlMessage): void {
        const link = this._ensureSendLink(peerId)
        link.send(msg)
    }

    private _ensureSendLink(peerId: string): ControlLink {
        const pc = this._peerControl(peerId)
        if (pc.out) return pc.out
        if (pc.in) return pc.in
        const channel = this._hub.createDataChannel(peerId, CONTROL_CHANNEL_LABEL, {
            ordered: true,
        })
        if (!channel) {
            throw new FileTransferError(
                `no connection to peer '${peerId}'`,
                FileTransferErrorCode.ChannelClosed,
            )
        }
        channel.binaryType = 'arraybuffer'
        const link = new ControlLink(channel, (raw) => this._onControlRaw(peerId, raw))
        pc.out = link
        return link
    }

    private _peerControl(peerId: string): PeerControl {
        let pc = this._control.get(peerId)
        if (!pc) {
            pc = {}
            this._control.set(peerId, pc)
        }
        return pc
    }

    private _toSource(input: SendInput): FileSource {
        if (typeof (input as FileSource).slice === 'function' && 'mimeType' in input) {
            return input as FileSource
        }
        return new BlobFileSource(input as Blob)
    }

    private _wrap(err: unknown): FileTransferError {
        if (err instanceof FileTransferError) return err
        const e = toError(err)
        return new FileTransferError(e.message, FileTransferErrorCode.InvalidFrame, { cause: err })
    }
}
