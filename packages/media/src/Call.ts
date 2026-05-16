import { EventEmitter, MessageType } from '@rtcforge/sdk'
import type { Room } from '@rtcforge/sdk'
import { PeerConnection } from './PeerConnection.js'
import { SignalKind, SignalType, isMediaSignal } from './protocol.js'
import type { MediaSignal } from './protocol.js'
import { ConnectionEvent, MediaEvent } from './types.js'
import type { CallOptions } from './types.js'

type CallEvents = {
    [MediaEvent.RemoteStream]: [peerId: string, stream: MediaStream]
    [MediaEvent.RemoteStreamRemoved]: [peerId: string]
}

export class Call extends EventEmitter<CallEvents> {
    private readonly room: Room
    private readonly opts: CallOptions
    private readonly connections = new Map<string, PeerConnection>()
    private readonly localTracks: Array<{ track: MediaStreamTrack; stream: MediaStream }> = []
    private started = false
    private closed = false

    constructor(room: Room, opts: CallOptions = {}) {
        super()
        this.room = room
        this.opts = opts
        if (opts.stream) {
            for (const track of opts.stream.getTracks()) {
                this.localTracks.push({ track, stream: opts.stream })
            }
        }
    }

    start(): void {
        if (this.started || this.closed) return
        this.started = true

        for (const peerId of this.room.peers) {
            if (peerId !== this.room.localPeerId) {
                this.getOrCreateConnection(peerId)
            }
        }

        this.room.on(MessageType.PeerJoined, this.handlePeerJoined)
        this.room.on(MessageType.PeerLeft, this.handlePeerLeft)
        this.room.on(MessageType.Signal, this.handleRoomSignal)
    }

    addTrack(track: MediaStreamTrack, stream: MediaStream): void {
        this.localTracks.push({ track, stream })
        for (const pc of this.connections.values()) {
            pc.addTrack(track, stream)
        }
    }

    close(): void {
        if (!this.started || this.closed) return
        this.closed = true
        this.room.off(MessageType.PeerJoined, this.handlePeerJoined)
        this.room.off(MessageType.PeerLeft, this.handlePeerLeft)
        this.room.off(MessageType.Signal, this.handleRoomSignal)
        for (const pc of this.connections.values()) {
            pc.removeAllListeners()
            pc.close()
        }
        this.connections.clear()
    }

    private readonly handlePeerJoined = (peerId: string): void => {
        this.getOrCreateConnection(peerId)
    }

    private readonly handlePeerLeft = (peerId: string): void => {
        const pc = this.connections.get(peerId)
        if (!pc) return
        pc.removeAllListeners()
        pc.close()
        this.connections.delete(peerId)
        this.emit(MediaEvent.RemoteStreamRemoved, peerId)
    }

    private readonly handleRoomSignal = async (from: string, data: unknown): Promise<void> => {
        if (!isMediaSignal(data)) return
        const pc = this.getOrCreateConnection(from)

        switch (data.type) {
            case SignalType.Offer: {
                const answer = await pc.handleOffer(data.sdp)
                if (answer?.sdp) {
                    const signal: MediaSignal = {
                        kind: SignalKind.Media,
                        type: SignalType.Answer,
                        sdp: answer.sdp,
                    }
                    this.room.sendSignal(from, signal)
                }
                break
            }
            case SignalType.Answer:
                await pc.handleAnswer(data.sdp)
                break
            case SignalType.Ice:
                await pc.addIceCandidate(data.candidate)
                break
        }
    }

    private getOrCreateConnection(peerId: string): PeerConnection {
        const existing = this.connections.get(peerId)
        if (existing) return existing

        // Lexicographically smaller peer ID yields on offer collision
        const polite = this.room.localPeerId < peerId
        const pc = new PeerConnection(polite, this.opts.rtcConfig)
        this.connections.set(peerId, pc)

        for (const { track, stream } of this.localTracks) {
            pc.addTrack(track, stream)
        }

        pc.on(ConnectionEvent.IceCandidate, (candidate) => {
            const signal: MediaSignal = { kind: SignalKind.Media, type: SignalType.Ice, candidate }
            this.room.sendSignal(peerId, signal)
        })

        pc.on(ConnectionEvent.NegotiationNeeded, (desc) => {
            if (desc.sdp) {
                const signal: MediaSignal = {
                    kind: SignalKind.Media,
                    type: SignalType.Offer,
                    sdp: desc.sdp,
                }
                this.room.sendSignal(peerId, signal)
            }
        })

        pc.on(ConnectionEvent.Track, (_track, streams) => {
            const stream = streams[0]
            if (stream) this.emit(MediaEvent.RemoteStream, peerId, stream)
        })

        return pc
    }
}
