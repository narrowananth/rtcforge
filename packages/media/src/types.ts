import type { Logger, MetricsCollector } from '@rtcforge/core'

export const MediaEvent = {
    RemoteStream: 'remote-stream',
    RemoteStreamRemoved: 'remote-stream-removed',
    TrackPublished: 'track-published',
} as const

export type MediaEvent = (typeof MediaEvent)[keyof typeof MediaEvent]

export const ConnectionEvent = {
    NegotiationNeeded: 'negotiation-needed',
    IceCandidate: 'ice-candidate',
    Track: 'track',
    StateChange: 'state-change',
} as const

export type ConnectionEvent = (typeof ConnectionEvent)[keyof typeof ConnectionEvent]

export interface CallOptions {
    stream?: MediaStream
    iceServers?: RTCIceServer[]
    rtcConfig?: RTCConfiguration
    codec?: string
    maxBitrate?: number
    logger?: Logger
    metrics?: MetricsCollector
}
