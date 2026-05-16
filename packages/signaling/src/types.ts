import type { Server } from 'node:http'
import { z } from 'zod'

export interface Logger {
    debug(msg: string, ctx?: Record<string, unknown>): void
    info(msg: string, ctx?: Record<string, unknown>): void
    warn(msg: string, ctx?: Record<string, unknown>): void
    error(msg: string, ctx?: Record<string, unknown>): void
}

export const noopLogger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
}

export interface MetricsCollector {
    increment(metric: string, labels?: Record<string, string>): void
    gauge(metric: string, value: number, labels?: Record<string, string>): void
}

export const noopMetrics: MetricsCollector = {
    increment: () => {},
    gauge: () => {},
}

export const Metric = {
    RoomsCreated: 'rooms_created',
    RoomsClosed: 'rooms_closed',
    PeersConnected: 'peers_connected',
    PeersDisconnected: 'peers_disconnected',
    SignalsRelayed: 'signals_relayed',
    AuthErrors: 'auth_errors',
    ActiveRooms: 'active_rooms',
    ActivePeers: 'active_peers',
} as const

export type Metric = (typeof Metric)[keyof typeof Metric]

export const PeerRole = {
    Host: 'host',
    Participant: 'participant',
    Viewer: 'viewer',
} as const

export type PeerRole = (typeof PeerRole)[keyof typeof PeerRole]

export const PeerRoleSchema = z.enum(PeerRole)

export const AuthPayloadSchema = z.object({
    roomId: z.string().min(1),
    peerId: z.string().min(1),
    role: PeerRoleSchema,
})

export type AuthPayload = z.infer<typeof AuthPayloadSchema>

export type AuthFunction = (token: string) => Promise<AuthPayload>

export const RoomState = {
    Active: 'active',
    Closing: 'closing',
    Closed: 'closed',
} as const

export type RoomState = (typeof RoomState)[keyof typeof RoomState]

export const RoomEvent = {
    PeerJoined: 'peerJoined',
    PeerLeft: 'peerLeft',
    Closed: 'closed',
} as const

export type RoomEvent = (typeof RoomEvent)[keyof typeof RoomEvent]

export const ServerEvent = {
    RoomCreated: 'roomCreated',
    Error: 'error',
} as const

export type ServerEvent = (typeof ServerEvent)[keyof typeof ServerEvent]

export const PeerEvent = {
    Disconnected: 'disconnected',
} as const

export type PeerEvent = (typeof PeerEvent)[keyof typeof PeerEvent]

export const CloseCode = {
    Normal: 1000,
    GoingAway: 1001,
    PolicyViolation: 1008,
} as const

export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode]

export const CloseReason = {
    ReplacedByReconnection: 'Replaced by reconnection',
    HeartbeatTimeout: 'Heartbeat timeout',
    MissingRoomOrPeer: 'Missing roomId or peerId',
    InvalidAuthPayload: 'Invalid auth payload',
    AuthFailed: 'Auth failed',
    ServerStopping: 'Server stopping',
} as const

export type CloseReason = (typeof CloseReason)[keyof typeof CloseReason]

export interface SignalingServerOptions {
    port?: number
    server?: Server
    auth?: AuthFunction
    pingInterval?: number
    pongTimeout?: number
    logger?: Logger
    metrics?: MetricsCollector
}
