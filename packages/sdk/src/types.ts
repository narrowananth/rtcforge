export interface RTCForgeClientOptions {
    serverUrl: string
    token?: string
    reconnect?: boolean
    maxReconnectDelay?: number
}

export const ConnectionState = {
    Disconnected: 'disconnected',
    Connecting: 'connecting',
    Connected: 'connected',
    Reconnecting: 'reconnecting',
} as const

export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState]

export const RoomEvent = {
    Closed: 'closed',
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
