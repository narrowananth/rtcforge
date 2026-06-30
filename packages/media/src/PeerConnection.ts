import { EventEmitter, noopLogger } from 'rtcforge-core'
import type { Logger, MediaKind } from 'rtcforge-core'
import { ConnectionEvent } from './types.js'
import type { CallOptions } from './types.js'

type PeerConnectionEvents = {
    [ConnectionEvent.NegotiationNeeded]: [desc: RTCSessionDescriptionInit]
    [ConnectionEvent.IceCandidate]: [candidate: RTCIceCandidateInit | null]
    [ConnectionEvent.Track]: [track: MediaStreamTrack, streams: readonly MediaStream[]]
    [ConnectionEvent.StateChange]: [state: RTCPeerConnectionState]
    [ConnectionEvent.Error]: [error: unknown]
    [ConnectionEvent.DataChannel]: [channel: RTCDataChannel]
}

export class PeerConnection extends EventEmitter<PeerConnectionEvents> {
    private readonly pc: RTCPeerConnection
    private static readonly MAX_PENDING_CANDIDATES = 100
    private readonly polite: boolean
    private makingOffer = false
    private _offerGeneration = 0
    private readonly pendingCandidates: RTCIceCandidateInit[] = []
    private _eocBuffered = false
    private readonly opts: CallOptions
    private readonly _logger: Logger
    private readonly _senderMap = new Map<MediaStreamTrack, RTCRtpSender>()

    constructor(polite: boolean, opts: CallOptions = {}) {
        super()
        this.polite = polite
        this.opts = opts
        this._logger = opts.logger ?? noopLogger
        const config: RTCConfiguration = {
            ...opts.rtcConfig,
            iceServers: opts.iceServers ?? [],
        }
        const createPc = opts.peerConnectionFactory ?? ((c) => new RTCPeerConnection(c))
        this.pc = createPc(config)

        this.pc.onnegotiationneeded = async () => {
            if (this.makingOffer) return
            this.makingOffer = true
            const gen = ++this._offerGeneration
            try {
                await this.pc.setLocalDescription()
                if (gen !== this._offerGeneration) return
                const desc = this.pc.localDescription
                if (desc?.type === 'offer') this.emit(ConnectionEvent.NegotiationNeeded, desc)
            } catch (err) {
                if (gen === this._offerGeneration) this.emit(ConnectionEvent.Error, err)
            } finally {
                if (gen === this._offerGeneration) this.makingOffer = false
            }
        }

        this.pc.onicecandidate = ({ candidate }) => {
            if (candidate && this.opts.candidateFilter && !this.opts.candidateFilter(candidate))
                return
            this.emit(ConnectionEvent.IceCandidate, candidate ? candidate.toJSON() : null)
        }

        this.pc.ondatachannel = (e) => {
            this.emit(ConnectionEvent.DataChannel, e.channel)
        }

        this.pc.ontrack = ({ track, streams }) => {
            this.emit(ConnectionEvent.Track, track, streams)
        }

        this.pc.onconnectionstatechange = () => {
            this.emit(
                ConnectionEvent.StateChange,
                this.pc.connectionState as RTCPeerConnectionState,
            )
        }
    }

    async handleOffer(sdp: string): Promise<RTCSessionDescriptionInit | null> {
        try {
            const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable'

            if (offerCollision) {
                if (!this.polite) return null
                ++this._offerGeneration
                this.makingOffer = false
                await this.pc.setLocalDescription({ type: 'rollback' })
            }

            await this.pc.setRemoteDescription({ type: 'offer', sdp })
            await this.drainCandidates()
            await this.pc.setLocalDescription()

            return this.pc.localDescription
        } catch (err) {
            this.emit(ConnectionEvent.Error, err)
            return null
        }
    }

    async handleAnswer(sdp: string): Promise<void> {
        try {
            await this.pc.setRemoteDescription({ type: 'answer', sdp })
            await this.drainCandidates()
        } catch (err) {
            this.emit(ConnectionEvent.Error, err)
        }
    }

    async addIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
        if (!this.pc.remoteDescription) {
            if (candidate === null) {
                this._eocBuffered = true
            } else if (this.pendingCandidates.length < PeerConnection.MAX_PENDING_CANDIDATES) {
                this.pendingCandidates.push(candidate)
            } else {
                this.emit(
                    ConnectionEvent.Error,
                    new Error(
                        `ICE candidate buffer full (max ${PeerConnection.MAX_PENDING_CANDIDATES}); candidate dropped`,
                    ),
                )
            }
            return
        }
        try {
            await this.pc.addIceCandidate(candidate ?? undefined)
        } catch {}
    }

    addTrack(track: MediaStreamTrack, stream: MediaStream, maxBitrate?: number): RTCRtpSender {
        let sender: RTCRtpSender
        const simulcastLayers = this.opts.simulcast?.layers
        if (simulcastLayers?.length || maxBitrate !== undefined) {
            const sendEncodings = simulcastLayers?.length
                ? simulcastLayers.map((l) => ({
                      rid: l.rid,
                      maxBitrate: l.maxBitrate,
                      scaleResolutionDownBy: l.scaleResolutionDownBy,
                  }))
                : [{ maxBitrate: maxBitrate as number }]
            const transceiver = this.pc.addTransceiver(track, {
                direction: 'sendrecv',
                streams: [stream],
                sendEncodings,
            })
            sender = transceiver.sender
        } else {
            sender = this.pc.addTrack(track, stream)
        }
        this._senderMap.set(track, sender)
        this.applyCodecPreference(sender)
        return sender
    }

    async replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): Promise<void> {
        const sender = this._senderMap.get(oldTrack)
        if (!sender) return
        await sender.replaceTrack(newTrack)
        this._senderMap.delete(oldTrack)
        this._senderMap.set(newTrack, sender)
    }

    createDataChannel(label: string, opts?: RTCDataChannelInit): RTCDataChannel {
        return this.pc.createDataChannel(label, opts)
    }

    removeTrack(track: MediaStreamTrack): void {
        const sender = this._senderMap.get(track)
        if (!sender) return
        this.pc.removeTrack(sender)
        this._senderMap.delete(track)
    }

    restartIce(): void {
        this.pc.restartIce()
    }

    getStats(): Promise<RTCStatsReport> {
        return this.pc.getStats()
    }

    close(): void {
        this.pc.close()
    }

    private applyCodecPreference(sender: RTCRtpSender): void {
        if (!this.opts.codec) return
        const codec = this.opts.codec
        const kind = sender.track?.kind as MediaKind | undefined
        if (!kind) return

        const capabilities = RTCRtpSender.getCapabilities(kind)
        if (!capabilities) return

        const lowerCodec = codec.toLowerCase()
        const preferred = capabilities.codecs.filter((c) =>
            c.mimeType.toLowerCase().includes(lowerCodec),
        )
        if (preferred.length === 0) return
        const rest = capabilities.codecs.filter(
            (c) => !c.mimeType.toLowerCase().includes(lowerCodec),
        )
        const transceiver = this.pc.getTransceivers().find((t) => t.sender === sender)
        if (transceiver) {
            try {
                transceiver.setCodecPreferences([...preferred, ...rest])
            } catch {}
        }
    }

    private async drainCandidates(): Promise<void> {
        for (const c of this.pendingCandidates) {
            try {
                await this.pc.addIceCandidate(c)
            } catch {}
        }
        this.pendingCandidates.length = 0
        if (this._eocBuffered) {
            this._eocBuffered = false
            try {
                await this.pc.addIceCandidate(undefined)
            } catch {}
        }
    }
}
