export const MediaEvent = {
    RemoteStream: 'remote-stream',
    RemoteStreamRemoved: 'remote-stream-removed',
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
    rtcConfig?: RTCConfiguration
}
