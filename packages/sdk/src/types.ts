import type { Logger } from '@rtcforge/core'

export { noopLogger } from '@rtcforge/core'
export type { Logger }

export interface IceServerConfig {
    urls: string | string[]
    username?: string
    credential?: string
}

export interface RTCForgeClientOptions {
    serverUrl: string
    token?: string
    tokenRefresh?: () => Promise<string>
    peerId?: string
    reconnect?: boolean
    maxReconnectDelay?: number
    maxReconnectAttempts?: number
    connectTimeoutMs?: number
    maxQueueSize?: number
    joinTimeoutMs?: number
    logger?: Logger
}

export const ConnectionState = {
    Disconnected: 'disconnected',
    Connecting: 'connecting',
    Connected: 'connected',
    Reconnecting: 'reconnecting',
} as const

export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState]

export interface CallInterface {
    addTrack(track: MediaStreamTrack, stream: MediaStream): void
    removeTrack(track: MediaStreamTrack): void
    replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): Promise<void>
    getStats(peerId?: string): Promise<Map<string, RTCStatsReport>>
    createDataChannel(
        peerId: string,
        label: string,
        opts?: RTCDataChannelInit,
    ): RTCDataChannel | undefined
    muteAudio(): void
    unmuteAudio(): void
    muteVideo(): void
    unmuteVideo(): void
    isAudioMuted(): boolean
    isVideoMuted(): boolean
    on(event: 'remote-stream', handler: (peerId: string, stream: MediaStream) => void): void
    on(event: 'remote-stream-removed', handler: (peerId: string) => void): void
    start(): void
    close(): void
}

export const RoomEvent = {
    Closed: 'closed',
    Refreshed: 'refreshed',
} as const

export type RoomEvent = (typeof RoomEvent)[keyof typeof RoomEvent]

export const ClientEvent = {
    Connected: 'connected',
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    Error: 'error',
} as const

export type ClientEvent = (typeof ClientEvent)[keyof typeof ClientEvent]

export const TransportEvent = {
    Open: 'open',
    Close: 'close',
    Message: 'message',
    Error: 'error',
    Reconnecting: 'reconnecting',
} as const

export type TransportEvent = (typeof TransportEvent)[keyof typeof TransportEvent]

export const CloseCode = {
    Normal: 1000,
} as const

export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode]

export const CloseReason = {
    ClientClosed: 'Client closed',
} as const

export type CloseReason = (typeof CloseReason)[keyof typeof CloseReason]
