import { EventEmitter, noopLogger, toError } from 'rtcforge-core'
import type { Logger } from 'rtcforge-core'
import { MessageType, RoomEvent } from 'rtcforge-sdk'
import type { Room } from 'rtcforge-sdk'
import { ActiveSpeakerDetector } from './ActiveSpeakerDetector.js'
import { LocalTrackRegistry } from './LocalTrackRegistry.js'
import { PeerConnection } from './PeerConnection.js'
import { SignalKind, SignalType, isMediaSignal } from './protocol.js'
import type { MediaSignal } from './protocol.js'
import { ConnectionEvent, MediaEvent } from './types.js'
import type { CallOptions } from './types.js'

type CallEvents = {
    [MediaEvent.RemoteStream]: [peerId: string, stream: MediaStream]
    [MediaEvent.RemoteStreamRemoved]: [peerId: string]
    [MediaEvent.TrackPublished]: [track: MediaStreamTrack, stream: MediaStream]
    [MediaEvent.Error]: [peerId: string, err: Error]
    [MediaEvent.DataChannel]: [peerId: string, channel: RTCDataChannel]
    [MediaEvent.ActiveSpeaker]: [peerId: string | null, audioLevel: number]
    [MediaEvent.ConnectionFailed]: [peerId: string]
}

export class Call extends EventEmitter<CallEvents> {
    private readonly room: Room
    private readonly opts: CallOptions
    private readonly logger: Logger
    private readonly connections = new Map<string, PeerConnection>()
    private readonly _negTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly tracks: LocalTrackRegistry
    private started = false
    private closed = false
    private _activeSpeaker: ActiveSpeakerDetector | null = null

    constructor(room: Room, opts: CallOptions = {}) {
        super()
        this.room = room
        this.opts = opts
        this.logger = opts.logger ?? noopLogger
        this.tracks = new LocalTrackRegistry(opts.stream)
    }

    start(): void {
        if (this.started || this.closed) return
        this.started = true
        this.logger.info('Call started', { localPeerId: this.room.localPeerId })

        for (const peerId of this.room.peers) {
            if (peerId !== this.room.localPeerId) {
                this.getOrCreateConnection(peerId)
            }
        }

        this.room.on(MessageType.PeerJoined, this.handlePeerJoined)
        this.room.on(MessageType.PeerLeft, this.handlePeerLeft)
        this.room.on(MessageType.Signal, this.handleRoomSignal)
        this.room.on(RoomEvent.Refreshed, this.handleRoomRefreshed)
    }

    addTrack(
        track: MediaStreamTrack,
        stream: MediaStream,
        opts?: { contentHint?: string; maxBitrate?: number },
    ): void {
        if (opts?.contentHint) {
            ;(track as MediaStreamTrack & { contentHint?: string }).contentHint = opts.contentHint
        }
        const bitrate = opts?.maxBitrate ?? this.opts.maxBitrate
        this.tracks.add(track, stream)
        for (const pc of this.connections.values()) {
            pc.addTrack(track, stream, bitrate)
        }
        this.emit(MediaEvent.TrackPublished, track, stream)
    }

    async replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): Promise<void> {
        this.tracks.replace(oldTrack, newTrack)
        await Promise.all(
            Array.from(this.connections.values(), (pc) => pc.replaceTrack(oldTrack, newTrack)),
        )
    }

    addScreenTrack(track: MediaStreamTrack, stream: MediaStream): void {
        this.addTrack(track, stream, {
            contentHint: this.opts.screenShare?.contentHint,
            maxBitrate: this.opts.screenShare?.maxBitrate,
        })
    }

    createDataChannel(
        peerId: string,
        label: string,
        opts?: RTCDataChannelInit,
    ): RTCDataChannel | undefined {
        return this.connections.get(peerId)?.createDataChannel(label, opts)
    }

    async getStats(peerId?: string): Promise<Map<string, RTCStatsReport>> {
        const result = new Map<string, RTCStatsReport>()
        if (peerId) {
            const pc = this.connections.get(peerId)
            if (pc) result.set(peerId, await pc.getStats())
        } else {
            await Promise.all(
                Array.from(this.connections.entries(), async ([pid, pc]) => {
                    result.set(pid, await pc.getStats())
                }),
            )
        }
        return result
    }

    startActiveSpeakerDetection(intervalMs = 1000): void {
        if (this._activeSpeaker === null) {
            this._activeSpeaker = new ActiveSpeakerDetector(
                () => this.connections.entries(),
                (peerId, level) => this.emit(MediaEvent.ActiveSpeaker, peerId, level),
                intervalMs,
            )
        }
        this._activeSpeaker.start()
    }

    stopActiveSpeakerDetection(): void {
        this._activeSpeaker?.stop()
        this._activeSpeaker = null
    }

    removeTrack(track: MediaStreamTrack): void {
        for (const pc of this.connections.values()) {
            pc.removeTrack(track)
        }
        this.tracks.remove(track)
    }

    muteAudio(): void {
        this.tracks.setKindEnabled('audio', false)
    }
    unmuteAudio(): void {
        this.tracks.setKindEnabled('audio', true)
    }
    muteVideo(): void {
        this.tracks.setKindEnabled('video', false)
    }
    unmuteVideo(): void {
        this.tracks.setKindEnabled('video', true)
    }
    isAudioMuted(): boolean {
        return this.tracks.isKindMuted('audio')
    }
    isVideoMuted(): boolean {
        return this.tracks.isKindMuted('video')
    }

    restart(): void {
        this.stopActiveSpeakerDetection()
        this._teardownConnections()
        this._detachRoomListeners()
        this.started = false
        this.closed = false
        this.start()
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        this.logger.info('Call closed', { localPeerId: this.room.localPeerId })
        this.stopActiveSpeakerDetection()
        this.tracks.clear()
        this._detachRoomListeners()
        this._teardownConnections()
    }

    private _teardownConnections(): void {
        for (const timer of this._negTimers.values()) clearTimeout(timer)
        this._negTimers.clear()
        for (const pc of this.connections.values()) {
            pc.removeAllListeners()
            pc.close()
        }
        this.connections.clear()
    }

    private _detachRoomListeners(): void {
        if (!this.started) return
        this.room.off(MessageType.PeerJoined, this.handlePeerJoined)
        this.room.off(MessageType.PeerLeft, this.handlePeerLeft)
        this.room.off(MessageType.Signal, this.handleRoomSignal)
        this.room.off(RoomEvent.Refreshed, this.handleRoomRefreshed)
    }

    private _clearPeerTimer(peerId: string): void {
        const timer = this._negTimers.get(peerId)
        if (timer) {
            clearTimeout(timer)
            this._negTimers.delete(peerId)
        }
    }

    private _dropConnection(peerId: string, pc: PeerConnection): void {
        this.connections.delete(peerId)
        pc.removeAllListeners()
        pc.close()
    }

    private readonly handleRoomRefreshed = (): void => {
        this.restart()
    }

    private readonly handlePeerJoined = (peerId: string): void => {
        this.logger.debug('Peer joined, creating connection', { peerId })
        this.getOrCreateConnection(peerId)
    }

    private readonly handlePeerLeft = (peerId: string): void => {
        this.logger.debug('Peer left, closing connection', { peerId })
        this._clearPeerTimer(peerId)
        const pc = this.connections.get(peerId)
        if (!pc) return
        this._dropConnection(peerId, pc)
        this.emit(MediaEvent.RemoteStreamRemoved, peerId)
    }

    private readonly handleRoomSignal = async (from: string, data: unknown): Promise<void> => {
        if (!isMediaSignal(data)) return
        if (!this.connections.has(from) && !this.room.hasPeer(from)) return
        const wasNew = !this.connections.has(from)
        const pc = this.getOrCreateConnection(from)

        try {
            switch (data.type) {
                case SignalType.Offer: {
                    this.logger.debug('Received offer', { from })
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
                    this.logger.debug('Received answer', { from })
                    await pc.handleAnswer(data.sdp)
                    break
                case SignalType.Ice:
                    await pc.addIceCandidate(data.candidate)
                    break
            }
        } catch (err) {
            this.logger.warn('Signal handling error', { from, err })
            if (wasNew) this._dropConnection(from, pc)
            this.emit(MediaEvent.Error, from, toError(err))
        }
    }

    private getOrCreateConnection(peerId: string): PeerConnection {
        const existing = this.connections.get(peerId)
        if (existing) return existing

        const polite = this.opts.isPolite
            ? this.opts.isPolite(this.room.localPeerId, peerId)
            : this.room.localPeerId < peerId
        const pc = new PeerConnection(polite, this.opts)
        this.connections.set(peerId, pc)

        for (const { track, stream } of this.tracks.entries) {
            pc.addTrack(track, stream, this.opts.maxBitrate)
        }

        this._wireConnection(pc, peerId)
        return pc
    }

    private _wireConnection(pc: PeerConnection, peerId: string): void {
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
                if (this.opts.negotiationTimeoutMs) {
                    this._clearPeerTimer(peerId)
                    this._negTimers.set(
                        peerId,
                        setTimeout(() => {
                            this._negTimers.delete(peerId)
                            if (this.connections.get(peerId) !== pc) return
                            this._dropConnection(peerId, pc)
                            this.emit(MediaEvent.Error, peerId, new Error('Negotiation timeout'))
                        }, this.opts.negotiationTimeoutMs),
                    )
                }
            }
        })

        pc.on(ConnectionEvent.Track, (_track, streams) => {
            const stream = streams[0]
            if (stream) {
                this.logger.debug('Remote stream received', { peerId })
                this.emit(MediaEvent.RemoteStream, peerId, stream)
            }
        })

        pc.on(ConnectionEvent.StateChange, (state) => {
            if (state === 'connected' || state === 'closed' || state === 'failed') {
                this._clearPeerTimer(peerId)
            }
            if (state === 'failed') {
                this._dropConnection(peerId, pc)
                this.emit(MediaEvent.ConnectionFailed, peerId)
            }
        })

        pc.on(ConnectionEvent.DataChannel, (channel) => {
            this.emit(MediaEvent.DataChannel, peerId, channel)
        })

        pc.on(ConnectionEvent.Error, (err) => {
            this.logger.warn('PeerConnection error', { peerId, err })
            if (this.connections.get(peerId) === pc) {
                this._clearPeerTimer(peerId)
                this._dropConnection(peerId, pc)
            }
            this.emit(MediaEvent.Error, peerId, toError(err))
        })
    }
}
