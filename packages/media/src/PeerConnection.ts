import { EventEmitter } from '@rtcforge/core'
import { ConnectionEvent } from './types.js'
import type { CallOptions } from './types.js'

type PeerConnectionEvents = {
    [ConnectionEvent.NegotiationNeeded]: [desc: RTCSessionDescriptionInit]
    [ConnectionEvent.IceCandidate]: [candidate: RTCIceCandidateInit | null]
    [ConnectionEvent.Track]: [track: MediaStreamTrack, streams: readonly MediaStream[]]
    [ConnectionEvent.StateChange]: [state: RTCPeerConnectionState]
}

export class PeerConnection extends EventEmitter<PeerConnectionEvents> {
    private readonly pc: RTCPeerConnection
    // true = this peer yields on offer collision (rolls back its own offer)
    private readonly polite: boolean
    private makingOffer = false
    private readonly pendingCandidates: RTCIceCandidateInit[] = []

    constructor(polite: boolean, opts: CallOptions = {}) {
        super()
        this.polite = polite
        const config: RTCConfiguration = {
            ...opts.rtcConfig,
            iceServers: opts.iceServers ?? [],
        }
        this.pc = new RTCPeerConnection(config)

        this.pc.onnegotiationneeded = async () => {
            if (this.makingOffer) return
            this.makingOffer = true
            try {
                await this.pc.setLocalDescription()
                const desc = this.pc.localDescription
                // Only emit for offers — answers are returned directly by handleOffer()
                if (desc?.type === 'offer') this.emit(ConnectionEvent.NegotiationNeeded, desc)
            } finally {
                this.makingOffer = false
            }
        }

        this.pc.onicecandidate = ({ candidate }) => {
            this.emit(ConnectionEvent.IceCandidate, candidate ? candidate.toJSON() : null)
        }

        this.pc.ontrack = ({ track, streams }) => {
            this.emit(ConnectionEvent.Track, track, streams)
        }

        this.pc.onconnectionstatechange = () => {
            this.emit(ConnectionEvent.StateChange, this.pc.connectionState)
        }
    }

    async handleOffer(sdp: string): Promise<RTCSessionDescriptionInit | null> {
        const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable'

        if (offerCollision) {
            if (!this.polite) return null
            await this.pc.setLocalDescription({ type: 'rollback' })
        }

        await this.pc.setRemoteDescription({ type: 'offer', sdp })
        await this.drainCandidates()
        await this.pc.setLocalDescription()

        return this.pc.localDescription
    }

    async handleAnswer(sdp: string): Promise<void> {
        await this.pc.setRemoteDescription({ type: 'answer', sdp })
        await this.drainCandidates()
    }

    async addIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
        if (!this.pc.remoteDescription) {
            if (candidate) this.pendingCandidates.push(candidate)
            return
        }
        try {
            await this.pc.addIceCandidate(candidate ?? undefined)
        } catch {
            // Some browsers throw on the end-of-candidates null marker; safe to ignore
        }
    }

    addTrack(track: MediaStreamTrack, stream: MediaStream, maxBitrate?: number): RTCRtpSender {
        const sender = this.pc.addTrack(track, stream)
        if (maxBitrate !== undefined) {
            const params = sender.getParameters()
            if (params.encodings?.length) {
                params.encodings[0].maxBitrate = maxBitrate
            } else {
                params.encodings = [{ maxBitrate }]
            }
            sender.setParameters(params).catch(() => {
                // Best-effort — not all browsers support setParameters before negotiation
            })
        }
        return sender
    }

    close(): void {
        this.pc.close()
    }

    private async drainCandidates(): Promise<void> {
        for (const c of this.pendingCandidates) {
            try {
                await this.pc.addIceCandidate(c)
            } catch {
                // Buffered candidate rejected by browser; connection state events surface real failures
            }
        }
        this.pendingCandidates.length = 0
    }
}
