import { noopLogger } from '@rtcforge/core'
import type { Logger } from '@rtcforge/core'

export type { Logger }
export { noopLogger }

export const WhiteboardServiceEvent = {
    Event: 'event',
    Error: 'error',
} as const

export type WhiteboardServiceEvent =
    (typeof WhiteboardServiceEvent)[keyof typeof WhiteboardServiceEvent]

export interface WhiteboardEvent {
    from: string
    type: string
    data: unknown
    seq: number
    ts: number
}

export interface WhiteboardServiceOptions {
    logger?: Logger
    merge?: (current: unknown, incoming: WhiteboardEvent) => unknown
}
