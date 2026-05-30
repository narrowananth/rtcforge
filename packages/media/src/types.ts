import type { Logger, MetricsCollector } from '@rtcforge/core'

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
    /** Override the polite-peer role determination in Perfect Negotiation.
     *  Receives local and remote peer IDs; return true if local peer should be polite.
     *  Defaults to lexicographic comparison (`localPeerId < remotePeerId`). */
    isPolite?: (localPeerId: string, remotePeerId: string) => boolean
}

export interface TurnConfig {
    urls: string[]
    username?: string
    credential?: string
}

export interface MediaServiceOptions {
    logger?: Logger
}

/**
 * Convert a {@link TurnConfig} to an {@link RTCIceServer} for use with {@link CallOptions.iceServers}.
 */
export function turnConfigToIceServer(config: TurnConfig): RTCIceServer {
    return {
        urls: config.urls,
        ...(config.username !== undefined && { username: config.username }),
        ...(config.credential !== undefined && { credential: config.credential }),
    }
}
