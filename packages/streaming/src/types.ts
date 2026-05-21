import { noopLogger } from '@rtcforge/core'
import type { Logger } from '@rtcforge/core'

export type { Logger }
export { noopLogger }

export const StreamingSessionEvent = {
    ViewerJoined: 'viewerJoined',
    ViewerLeft: 'viewerLeft',
    ViewerCount: 'viewerCount',
    Error: 'error',
} as const

export type StreamingSessionEvent =
    (typeof StreamingSessionEvent)[keyof typeof StreamingSessionEvent]

export interface StreamingSessionOptions {
    hostPeerId: string
    maxViewers?: number
    logger?: Logger
}

export interface StreamingServiceOptions {
    logger?: Logger
}
