import type { types as MsTypes } from 'mediasoup'
import type { Logger, MediaKind, MetricsCollector } from 'rtcforge-core'

export interface RoomMemberLike {
    readonly id: string
}

export interface RoomLike {
    readonly id: string
    on(event: 'peerLeft', listener: (peer: RoomMemberLike) => void): unknown
    once(event: 'closed', listener: () => void): unknown
    off(event: 'peerLeft', listener: (peer: RoomMemberLike) => void): unknown
    off(event: 'closed', listener: () => void): unknown
}

export const RoomLikeEvent = {
    PeerLeft: 'peerLeft',
    Closed: 'closed',
} as const

export const MediaEvent = {
    RemoteStream: 'remote-stream',
    RemoteStreamRemoved: 'remote-stream-removed',
    TrackPublished: 'track-published',
    Error: 'error',
    DataChannel: 'data-channel',
    ActiveSpeaker: 'active-speaker',
    ConnectionFailed: 'connection-failed',
} as const

export type MediaEvent = (typeof MediaEvent)[keyof typeof MediaEvent]

export const ConnectionEvent = {
    NegotiationNeeded: 'negotiation-needed',
    IceCandidate: 'ice-candidate',
    Track: 'track',
    StateChange: 'state-change',
    Error: 'error',
    DataChannel: 'data-channel',
} as const

export type ConnectionEvent = (typeof ConnectionEvent)[keyof typeof ConnectionEvent]

export interface CallOptions {
    stream?: MediaStream
    iceServers?: RTCIceServer[]
    rtcConfig?: RTCConfiguration
    codec?: string
    maxBitrate?: number
    negotiationTimeoutMs?: number
    logger?: Logger
    metrics?: MetricsCollector
    simulcast?: {
        layers: Array<{ rid: string; maxBitrate: number; scaleResolutionDownBy?: number }>
    }
    screenShare?: {
        codec?: string
        maxBitrate?: number
        contentHint?: 'motion' | 'detail' | 'text'
    }
    candidateFilter?: (candidate: RTCIceCandidate) => boolean
    isPolite?: (localPeerId: string, remotePeerId: string) => boolean
    peerConnectionFactory?: (config: RTCConfiguration) => RTCPeerConnection
}

export type PeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection

export interface TurnConfig {
    urls: string[]
    username?: string
    credential?: string
}

export interface WorkerSettings {
    numWorkers?: number
    logLevel?: MsTypes.WorkerLogLevel
    logTags?: MsTypes.WorkerLogTag[]
    rtcMinPort?: number
    rtcMaxPort?: number
}

export interface WebRtcTransportConfig {
    listenInfos?: MsTypes.TransportListenInfo[]
    initialAvailableOutgoingBitrate?: number
    maxIncomingBitrate?: number
    enableSctp?: boolean
}

export interface MediaServiceOptions {
    logger?: Logger
    worker?: WorkerSettings
    mediaCodecs?: MsTypes.RouterRtpCodecCapability[]
    webRtcTransport?: WebRtcTransportConfig
}

export interface WebRtcTransportParams {
    id: string
    iceParameters: MsTypes.IceParameters
    iceCandidates: MsTypes.IceCandidate[]
    dtlsParameters: MsTypes.DtlsParameters
    sctpParameters?: MsTypes.SctpParameters
}

export interface PipeTransportParams {
    id: string
    ip: string
    port: number
    srtpParameters?: MsTypes.SrtpParameters
}

export interface PipeProducerParams {
    id: string
    kind: MediaKind
    rtpParameters: MsTypes.RtpParameters
    paused: boolean
}

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

export const DEFAULT_LISTEN_INFOS: MsTypes.TransportListenInfo[] = [
    { protocol: 'udp', ip: '127.0.0.1' },
    { protocol: 'tcp', ip: '127.0.0.1' },
]

export function turnConfigToIceServer(config: TurnConfig): RTCIceServer {
    return {
        urls: config.urls,
        ...(config.username !== undefined && { username: config.username }),
        ...(config.credential !== undefined && { credential: config.credential }),
    }
}
