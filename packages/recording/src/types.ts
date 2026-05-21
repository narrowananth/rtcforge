import { noopLogger } from '@rtcforge/core'
import type { Logger, MetricsCollector } from '@rtcforge/core'

export type { Logger, MetricsCollector }
export { noopLogger }

export const RecordingState = {
    Recording: 'recording',
    Paused: 'paused',
    Stopped: 'stopped',
} as const

export type RecordingState = (typeof RecordingState)[keyof typeof RecordingState]

export const RecordingEvent = {
    Data: 'data',
    Complete: 'complete',
    Error: 'error',
    Pause: 'pause',
    Resume: 'resume',
} as const

export type RecordingEvent = (typeof RecordingEvent)[keyof typeof RecordingEvent]

export interface RecordingOptions {
    mimeType?: string
    bitsPerSecond?: number
    videoBitsPerSecond?: number
    audioBitsPerSecond?: number
    timeslice?: number
    logger?: Logger
    metrics?: MetricsCollector
}

export interface RecordingCompleteEvent {
    blob: Blob
    duration: number
    mimeType: string
}
