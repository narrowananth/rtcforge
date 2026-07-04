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
    [MediaEvent.TrackUnpublished]: [track: MediaStreamTrack]
    [MediaEvent.Error]: [peerId: string, err: Error]
    [MediaEvent.DataChannel]: [peerId: string, channel: RTCDataChannel]
    [MediaEvent.ActiveSpeaker]: [peerId: string | null, audioLevel: number]
    [MediaEvent.ConnectionFailed]: [peerId: string]
}

/**
 * Browser P2P mesh call over a signaling {@link Room}. Manages one
 * {@link PeerConnection} per remote peer, wiring perfect negotiation, ICE, and
 * track publishing so that adding a track fans it out to every peer.
 *
 * It reacts to room membership: joining peers get a new connection, leaving
 * peers are torn down, and a {@link RoomEvent.Refreshed} triggers a full
 * {@link Call.restart}. All observable activity is surfaced as {@link MediaEvent}s.
 *
 * @remarks
 * Intended for small mesh calls where each participant connects directly to
 * every other participant. For many-participant rooms, use the SFU
 * ({@link MediaService}) instead.
 *
 * @example
 * ```ts
 * const stream = await getUserMedia({ audio: true, video: true })
 * const call = new Call(room, { stream, iceServers })
 *
 * call.on(MediaEvent.RemoteStream, (peerId, remoteStream) => {
 *   attachToVideoElement(peerId, remoteStream)
 * })
 * call.on(MediaEvent.RemoteStreamRemoved, (peerId) => detach(peerId))
 *
 * call.start()
 * // later
 * call.close()
 * ```
 */
export class Call extends EventEmitter<CallEvents> {
    private readonly room: Room
    private readonly opts: CallOptions
    private readonly logger: Logger
    private readonly connections = new Map<string, PeerConnection>()
    private readonly _negTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly _iceRestarts = new Map<string, number>()
    private readonly tracks: LocalTrackRegistry
    // Stream ids already announced per peer, so an audio+video peer sharing one
    // MediaStream fires RemoteStream once, not once per track.
    private readonly _remoteStreams = new Map<string, Set<string>>()
    // Per-local-track 'ended' listener removers, so they can be detached on
    // remove/replace/close instead of leaking the closure.
    private readonly _trackEndedCleanups = new Map<MediaStreamTrack, () => void>()
    private started = false
    private closed = false
    private _activeSpeaker: ActiveSpeakerDetector | null = null

    /**
     * @param room - The signaling room whose membership and signal messages drive the mesh.
     * @param opts - Call configuration (initial stream, ICE servers, codec, simulcast, etc.). Defaults to `{}`.
     */
    constructor(room: Room, opts: CallOptions = {}) {
        super()
        this.room = room
        this.opts = opts
        this.logger = opts.logger ?? noopLogger
        this.tracks = new LocalTrackRegistry(opts.stream)
        for (const { track } of this.tracks.entries) this._wireTrackEnded(track)
    }

    // When a local track ends (e.g. the camera is unplugged or revoked), drop it
    // from the registry and every peer connection so a dead track isn't re-added
    // to future peers; removing it from the PCs triggers renegotiation. The
    // listener is tracked in _trackEndedCleanups so it can be detached when the
    // track is removed/replaced/closed (otherwise the closure leaks the Call and
    // can fire a spurious TrackUnpublished after removal).
    private _wireTrackEnded(track: MediaStreamTrack): void {
        if (typeof track.addEventListener !== 'function') return
        if (this._trackEndedCleanups.has(track)) return
        const onEnded = () => {
            this._unwireTrackEnded(track)
            if (this.closed) return
            this.tracks.remove(track)
            for (const pc of this.connections.values()) pc.removeTrack(track)
            this.emit(MediaEvent.TrackUnpublished, track)
        }
        track.addEventListener('ended', onEnded)
        this._trackEndedCleanups.set(track, () => track.removeEventListener('ended', onEnded))
    }

    private _unwireTrackEnded(track: MediaStreamTrack): void {
        const cleanup = this._trackEndedCleanups.get(track)
        if (cleanup) {
            cleanup()
            this._trackEndedCleanups.delete(track)
        }
    }

    /**
     * Starts the call: creates connections to all current peers and subscribes
     * to room membership and signaling events. Idempotent, and a no-op once the
     * call has been closed.
     */
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

    /**
     * Publishes a local track to every peer connection and registers it so it is
     * also added to peers that join later. Emits {@link MediaEvent.TrackPublished}.
     *
     * @param track - The local media track to send.
     * @param stream - The stream the track belongs to.
     * @param opts - Optional per-track overrides.
     * @param opts.contentHint - Encoder content hint set on the track (e.g. `"motion"`, `"detail"`).
     * @param opts.maxBitrate - Maximum send bitrate in bits per second; falls back to {@link CallOptions.maxBitrate}.
     */
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
        this._wireTrackEnded(track)
        for (const pc of this.connections.values()) {
            pc.addTrack(track, stream, bitrate)
        }
        this.emit(MediaEvent.TrackPublished, track, stream)
    }

    /**
     * Replaces a published track with a new one on every peer connection without
     * renegotiation (e.g. switching cameras). Updates the local track registry.
     *
     * @param oldTrack - The currently published track.
     * @param newTrack - The track to send in its place.
     */
    async replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): Promise<void> {
        this.tracks.replace(oldTrack, newTrack)
        // Move the 'ended' watch from the old track to the new one, so an unplug
        // of the new track is detected and a stale old-track listener can't fire.
        this._unwireTrackEnded(oldTrack)
        this._wireTrackEnded(newTrack)
        await Promise.all(
            Array.from(this.connections.values(), (pc) => pc.replaceTrack(oldTrack, newTrack)),
        )
    }

    /**
     * Publishes a screen-share track, applying the content hint and max bitrate
     * from {@link CallOptions.screenShare}. Convenience over {@link Call.addTrack}.
     *
     * @param track - The screen-capture track.
     * @param stream - The stream the track belongs to.
     */
    addScreenTrack(track: MediaStreamTrack, stream: MediaStream): void {
        this.addTrack(track, stream, {
            contentHint: this.opts.screenShare?.contentHint,
            maxBitrate: this.opts.screenShare?.maxBitrate,
        })
    }

    /**
     * Opens a data channel to a specific peer.
     *
     * @param peerId - The target peer's id.
     * @param label - Data channel label.
     * @param opts - Optional data channel configuration.
     * @returns The created data channel, or `undefined` if no connection to that peer exists.
     */
    createDataChannel(
        peerId: string,
        label: string,
        opts?: RTCDataChannelInit,
    ): RTCDataChannel | undefined {
        return this.connections.get(peerId)?.createDataChannel(label, opts)
    }

    /**
     * Collects WebRTC statistics for one or all peer connections.
     *
     * @param peerId - If given, returns stats for just that peer; otherwise for all connected peers.
     * @returns A map of peer id to its `RTCStatsReport`.
     */
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

    /**
     * Starts polling remote audio levels and emitting {@link MediaEvent.ActiveSpeaker}
     * when the dominant speaker changes. Idempotent.
     *
     * @param intervalMs - Poll interval in milliseconds.
     * @defaultValue 1000
     */
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

    /** Stops active-speaker detection and releases its resources. Idempotent. */
    stopActiveSpeakerDetection(): void {
        this._activeSpeaker?.stop()
        this._activeSpeaker = null
    }

    /**
     * Unpublishes a track from every peer connection and removes it from the
     * local registry.
     *
     * @param track - The track to remove.
     */
    removeTrack(track: MediaStreamTrack): void {
        this._unwireTrackEnded(track)
        for (const pc of this.connections.values()) {
            pc.removeTrack(track)
        }
        this.tracks.remove(track)
    }

    /** Disables all local audio tracks (mutes the microphone) without renegotiating. */
    muteAudio(): void {
        this.tracks.setKindEnabled('audio', false)
    }
    /** Re-enables all local audio tracks. */
    unmuteAudio(): void {
        this.tracks.setKindEnabled('audio', true)
    }
    /** Disables all local video tracks (stops sending camera frames) without renegotiating. */
    muteVideo(): void {
        this.tracks.setKindEnabled('video', false)
    }
    /** Re-enables all local video tracks. */
    unmuteVideo(): void {
        this.tracks.setKindEnabled('video', true)
    }
    /** @returns Whether the local audio tracks are currently muted. */
    isAudioMuted(): boolean {
        return this.tracks.isKindMuted('audio')
    }
    /** @returns Whether the local video tracks are currently muted. */
    isVideoMuted(): boolean {
        return this.tracks.isKindMuted('video')
    }

    /**
     * Tears down all connections and room listeners, then starts fresh. Local
     * published tracks are preserved and re-added to the new connections. Invoked
     * automatically when the room signals {@link RoomEvent.Refreshed}.
     */
    restart(): void {
        this.stopActiveSpeakerDetection()
        this._teardownConnections()
        this._detachRoomListeners()
        this.started = false
        this.closed = false
        this.start()
    }

    /**
     * Permanently closes the call: stops active-speaker detection, clears local
     * tracks, detaches room listeners, and closes every peer connection. Idempotent;
     * a closed call cannot be restarted with {@link Call.start}.
     */
    close(): void {
        if (this.closed) return
        this.closed = true
        this.logger.info('Call closed', { localPeerId: this.room.localPeerId })
        this.stopActiveSpeakerDetection()
        // Stop local tracks (camera/mic) only when the caller opted in — by
        // default the app owns the stream and may reuse it.
        // Detach all local-track 'ended' listeners so a still-live reused track
        // doesn't retain this closed Call (memory leak across sequential calls).
        for (const cleanup of this._trackEndedCleanups.values()) cleanup()
        this._trackEndedCleanups.clear()
        if (this.opts.stopTracksOnClose) this.tracks.stopAll()
        else this.tracks.clear()
        this._remoteStreams.clear()
        this._detachRoomListeners()
        this._teardownConnections()
    }

    private _teardownConnections(): void {
        for (const timer of this._negTimers.values()) clearTimeout(timer)
        this._negTimers.clear()
        // Reset per-peer transient state so a restart() doesn't inherit a spent
        // ICE-restart budget or a stale seen-stream set for reused peer ids.
        this._iceRestarts.clear()
        this._remoteStreams.clear()
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
        this._iceRestarts.delete(peerId)
        this._remoteStreams.delete(peerId)
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
                    // The negotiation timer guards "offer sent, awaiting answer".
                    // Clear it here: a mid-call renegotiation on an already-
                    // connected PC fires no StateChange, so relying on state
                    // alone would let the timer expire and tear down a healthy call.
                    this._clearPeerTimer(from)
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
            if (!stream) return
            // Dedupe: an audio+video peer shares one stream across two track events.
            const seen = this._remoteStreams.get(peerId) ?? new Set<string>()
            if (seen.has(stream.id)) return
            seen.add(stream.id)
            this._remoteStreams.set(peerId, seen)
            this.logger.debug('Remote stream received', { peerId })
            this.emit(MediaEvent.RemoteStream, peerId, stream)
        })

        pc.on(ConnectionEvent.StateChange, (state) => {
            if (state === 'connected' || state === 'closed' || state === 'failed') {
                this._clearPeerTimer(peerId)
            }
            if (state === 'connected') {
                this._iceRestarts.delete(peerId)
            }
            if (state === 'failed') {
                if (this.connections.get(peerId) !== pc) return
                // A `failed` state is often just a network blip that a standard
                // ICE restart recovers. The impolite (offering) side drives the
                // restart; only drop after the retry budget is spent.
                const polite = this.opts.isPolite
                    ? this.opts.isPolite(this.room.localPeerId, peerId)
                    : this.room.localPeerId < peerId
                const attempts = this._iceRestarts.get(peerId) ?? 0
                const maxRestarts = this.opts.maxIceRestarts ?? 1
                if (!polite && attempts < maxRestarts) {
                    this._iceRestarts.set(peerId, attempts + 1)
                    this.logger.debug('ICE failed — attempting restart', {
                        peerId,
                        attempt: attempts + 1,
                    })
                    pc.restartIce()
                    return
                }
                this._iceRestarts.delete(peerId)
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
