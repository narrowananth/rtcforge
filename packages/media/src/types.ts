import type { types as MsTypes } from 'mediasoup'
import type { Logger, MediaKind, MetricsCollector } from 'rtcforge-core'

/**
 * Minimal shape of a room member the media layer needs — just an id.
 *
 * @remarks
 * A structural type so the media package stays decoupled from the concrete
 * signaling `Room`/`Peer`; anything with a matching `id` fits.
 */
export interface RoomMemberLike {
    /** The member's unique id within the room. */
    readonly id: string
}

/**
 * Minimal room contract the media layer subscribes to for lifecycle events.
 *
 * @remarks
 * Structural interface (see {@link RoomMemberLike}) letting {@link MediaService}
 * bind media resources to a room without depending on the signaling package: it
 * tears down a peer's media on `peerLeft` and the whole router on `closed`.
 */
export interface RoomLike {
    /** The room's unique id. */
    readonly id: string
    /** Subscribes to a peer leaving the room. */
    on(event: 'peerLeft', listener: (peer: RoomMemberLike) => void): unknown
    /** Subscribes once to the room closing. */
    once(event: 'closed', listener: () => void): unknown
    /** Unsubscribes a `peerLeft` listener. */
    off(event: 'peerLeft', listener: (peer: RoomMemberLike) => void): unknown
    /** Unsubscribes a `closed` listener. */
    off(event: 'closed', listener: () => void): unknown
}

export const RoomLikeEvent = {
    PeerLeft: 'peerLeft',
    Closed: 'closed',
} as const

/**
 * Events emitted by a {@link Call} on the browser P2P mesh.
 */
export const MediaEvent = {
    /** A remote peer's {@link MediaStream} became available. Payload: `(peerId, stream)`. */
    RemoteStream: 'remote-stream',
    /** A remote peer's stream was removed, typically because the peer left. Payload: `(peerId)`. */
    RemoteStreamRemoved: 'remote-stream-removed',
    /** A local track was published to the mesh. Payload: `(track, stream)`. */
    TrackPublished: 'track-published',
    /** A local track was unpublished — removed, or ended (e.g. device unplugged). Payload: `(track)`. */
    TrackUnpublished: 'track-unpublished',
    /** A recoverable per-peer error occurred. Payload: `(peerId, error)`. */
    Error: 'error',
    /** A remote-initiated data channel opened. Payload: `(peerId, channel)`. */
    DataChannel: 'data-channel',
    /** The active speaker changed. Payload: `(peerId | null, audioLevel)`. */
    ActiveSpeaker: 'active-speaker',
    /** A peer connection transitioned to the `failed` state and was dropped. Payload: `(peerId)`. */
    ConnectionFailed: 'connection-failed',
} as const

/** Union of the string values in {@link MediaEvent}. */
export type MediaEvent = (typeof MediaEvent)[keyof typeof MediaEvent]

/**
 * Low-level events emitted by a single {@link PeerConnection}. Consumers of the
 * high-level {@link Call} API normally listen to {@link MediaEvent} instead.
 */
export const ConnectionEvent = {
    /** A local offer is ready to send to the remote peer. Payload: `(description)`. */
    NegotiationNeeded: 'negotiation-needed',
    /** A local ICE candidate was gathered (or `null` for end-of-candidates). Payload: `(candidate)`. */
    IceCandidate: 'ice-candidate',
    /** A remote track was received. Payload: `(track, streams)`. */
    Track: 'track',
    /** The underlying `RTCPeerConnection` connection state changed. Payload: `(state)`. */
    StateChange: 'state-change',
    /** An error occurred during negotiation or signaling. Payload: `(error)`. */
    Error: 'error',
    /** A remote-initiated data channel opened. Payload: `(channel)`. */
    DataChannel: 'data-channel',
} as const

/** Union of the string values in {@link ConnectionEvent}. */
export type ConnectionEvent = (typeof ConnectionEvent)[keyof typeof ConnectionEvent]

/**
 * Configuration for a {@link Call} (and the {@link PeerConnection}s it creates).
 * All fields are optional; sensible defaults apply when omitted.
 */
export interface CallOptions {
    /** Initial local stream whose tracks are published to every peer connection. */
    stream?: MediaStream
    /** ICE servers (STUN/TURN) used for connectivity establishment. */
    iceServers?: RTCIceServer[]
    /** Additional `RTCConfiguration` merged into the peer connection config (e.g. bundle policy). */
    rtcConfig?: RTCConfiguration
    /** Preferred send codec, matched case-insensitively against the codec mime type (e.g. `"VP9"`). */
    codec?: string
    /** Default maximum send bitrate, in bits per second, applied to published tracks. */
    maxBitrate?: number
    /** If set, a peer whose renegotiation does not complete within this many milliseconds is dropped. */
    negotiationTimeoutMs?: number
    /**
     * Number of ICE restarts to attempt (impolite side) before dropping a
     * connection that reaches the `failed` state, letting a transient network
     * blip recover instead of tearing down the call. @defaultValue `1`
     */
    maxIceRestarts?: number
    /**
     * When `true`, {@link Call.close} calls `track.stop()` on the local tracks
     * (turning off the camera/mic). Leave `false` if the app owns and reuses the
     * stream elsewhere. @defaultValue `false`
     */
    stopTracksOnClose?: boolean
    /** Logger used for diagnostics. Defaults to a no-op logger. */
    logger?: Logger
    /** Optional metrics collector. */
    metrics?: MetricsCollector
    /** Simulcast configuration; each entry becomes an RTP send encoding on published tracks. */
    simulcast?: {
        /** Ordered simulcast layers (RID, max bitrate, and optional resolution downscale factor). */
        layers: Array<{ rid: string; maxBitrate: number; scaleResolutionDownBy?: number }>
    }
    /** Overrides applied specifically to screen-share tracks added via {@link Call.addScreenTrack}. */
    screenShare?: {
        /** Preferred codec for the screen-share track. */
        codec?: string
        /** Maximum send bitrate for the screen-share track, in bits per second. */
        maxBitrate?: number
        /** Content hint that tunes the encoder for the given content type. */
        contentHint?: 'motion' | 'detail' | 'text'
    }
    /** Predicate used to drop unwanted ICE candidates before they are signaled. Return `false` to filter. */
    candidateFilter?: (candidate: RTCIceCandidate) => boolean
    /**
     * Determines which side is the "polite" peer for perfect negotiation. Defaults to
     * comparing peer ids (`localPeerId < remotePeerId`). The polite peer rolls back on
     * offer collisions; the impolite peer ignores the colliding remote offer.
     */
    isPolite?: (localPeerId: string, remotePeerId: string) => boolean
    /** Factory for the underlying `RTCPeerConnection`, e.g. to inject a Node WebRTC implementation. */
    peerConnectionFactory?: (config: RTCConfiguration) => RTCPeerConnection
}

/** Factory that constructs an `RTCPeerConnection` from a given configuration. */
export type PeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection

/**
 * Minimal TURN/STUN server description, convertible to an `RTCIceServer` via
 * {@link turnConfigToIceServer}.
 */
export interface TurnConfig {
    /** One or more server URLs, e.g. `["turn:turn.example.com:3478"]`. */
    urls: string[]
    /** Username for long-term TURN credentials. */
    username?: string
    /** Credential (password) for long-term TURN credentials. */
    credential?: string
}

/**
 * Settings for the mediasoup {@link WorkerPool} on the SFU server side.
 */
export interface WorkerSettings {
    /** Number of worker subprocesses to spawn. Defaults to the number of logical CPUs. */
    numWorkers?: number
    /** mediasoup worker log level. Defaults to `"warn"`. */
    logLevel?: MsTypes.WorkerLogLevel
    /** mediasoup worker log tags to enable. */
    logTags?: MsTypes.WorkerLogTag[]
    /** Lowest UDP/TCP port a worker will bind for RTC. */
    rtcMinPort?: number
    /** Highest UDP/TCP port a worker will bind for RTC. */
    rtcMaxPort?: number
}

/**
 * Configuration applied to WebRTC transports created by a {@link MediaRouter} (SFU server side).
 */
export interface WebRtcTransportConfig {
    /** Listen IPs/protocols the transport binds. Defaults to {@link DEFAULT_LISTEN_INFOS}. */
    listenInfos?: MsTypes.TransportListenInfo[]
    /** Initial estimate of available outgoing bitrate, in bits per second. */
    initialAvailableOutgoingBitrate?: number
    /** If set, caps the transport's incoming bitrate, in bits per second. */
    maxIncomingBitrate?: number
    /** Whether to enable SCTP (data channels) on the transport. Defaults to `false`. */
    enableSctp?: boolean
}

/**
 * Options for constructing a {@link MediaService} (the SFU server-side entry point).
 */
export interface MediaServiceOptions {
    /** Logger used across the service, worker pool, and routers. Defaults to a no-op logger. */
    logger?: Logger
    /** mediasoup worker pool settings. */
    worker?: WorkerSettings
    /** Router media codecs. Defaults to {@link DEFAULT_MEDIA_CODECS}. */
    mediaCodecs?: MsTypes.RouterRtpCodecCapability[]
    /** WebRTC transport configuration shared by every router. */
    webRtcTransport?: WebRtcTransportConfig
}

/**
 * Transport parameters returned to a client so it can create a matching
 * client-side transport and connect it (server → client handshake payload).
 */
export interface WebRtcTransportParams {
    /** Server-side transport id. */
    id: string
    /** ICE parameters (ufrag/pwd) for the transport. */
    iceParameters: MsTypes.IceParameters
    /** Server-gathered ICE candidates. */
    iceCandidates: MsTypes.IceCandidate[]
    /** DTLS parameters (role and fingerprints). */
    dtlsParameters: MsTypes.DtlsParameters
    /** SCTP parameters, present only when SCTP/data channels are enabled. */
    sctpParameters?: MsTypes.SctpParameters
}

/**
 * Connection parameters for a mediasoup pipe transport, exchanged between two
 * routers to bridge producers across workers or servers.
 */
export interface PipeTransportParams {
    /** Pipe transport id. */
    id: string
    /** Local IP the pipe transport is listening on. */
    ip: string
    /** Local port the pipe transport is listening on. */
    port: number
    /** SRTP parameters when the pipe is encrypted. */
    srtpParameters?: MsTypes.SrtpParameters
}

/**
 * Description of a producer piped across a pipe transport, used to recreate it
 * on the destination router.
 */
export interface PipeProducerParams {
    /** Producer id, preserved across the pipe. */
    id: string
    /** Media kind of the piped producer. */
    kind: MediaKind
    /** RTP parameters of the piped producer. */
    rtpParameters: MsTypes.RtpParameters
    /** Whether the source producer is currently paused. */
    paused: boolean
}

/**
 * Default router media codecs: Opus audio plus VP8 and H.264 video. Used by
 * {@link MediaService} when no `mediaCodecs` are supplied.
 */
export const DEFAULT_MEDIA_CODECS: MsTypes.RouterRtpCodecCapability[] = [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: { 'x-google-start-bitrate': 1000 },
    },
    {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
        },
    },
]

/**
 * Default transport listen infos: UDP and TCP on loopback (`127.0.0.1`). Suitable
 * for local development; production deployments should supply public/announced IPs.
 */
export const DEFAULT_LISTEN_INFOS: MsTypes.TransportListenInfo[] = [
    { protocol: 'udp', ip: '127.0.0.1' },
    { protocol: 'tcp', ip: '127.0.0.1' },
]

/**
 * Converts a {@link TurnConfig} into a standard `RTCIceServer`, omitting the
 * `username`/`credential` fields when they are not provided.
 *
 * @param config - TURN/STUN server description.
 * @returns An `RTCIceServer` suitable for {@link CallOptions.iceServers}.
 *
 * @example
 * ```ts
 * const iceServers = [
 *   turnConfigToIceServer({ urls: ['stun:stun.example.com:3478'] }),
 *   turnConfigToIceServer({
 *     urls: ['turn:turn.example.com:3478'],
 *     username: 'user',
 *     credential: 'pass',
 *   }),
 * ]
 * ```
 */
export function turnConfigToIceServer(config: TurnConfig): RTCIceServer {
    return {
        urls: config.urls,
        ...(config.username !== undefined && { username: config.username }),
        ...(config.credential !== undefined && { credential: config.credential }),
    }
}
