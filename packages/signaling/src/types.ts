import type { Server } from 'node:http'
import { Metric, noopLogger, noopMetrics } from 'rtcforge-core'
import type { Logger, Membership, MetricsCollector, NodeInfo } from 'rtcforge-core'
import { z } from 'zod'

export type { Logger, MetricsCollector, Membership, NodeInfo }
export { noopLogger, noopMetrics, Metric }

export const AuthPayloadSchema = z.object({
    roomId: z.string().min(1),
    peerId: z.string().min(1),
    role: z.string(),
    metadata: z.record(z.string(), z.string()).optional(),
})

export type AuthPayload = z.infer<typeof AuthPayloadSchema>

export type AuthFunction = (token: string) => Promise<AuthPayload>

export const RoomState = {
    Creating: 'creating',
    Active: 'active',
    Closing: 'closing',
    Closed: 'closed',
} as const

export type RoomState = (typeof RoomState)[keyof typeof RoomState]

export const RoomEvent = {
    PeerJoined: 'peerJoined',
    PeerLeft: 'peerLeft',
    Closed: 'closed',
    PeerError: 'peerError',
    PeerKicked: 'peerKicked',
} as const

export type RoomEvent = (typeof RoomEvent)[keyof typeof RoomEvent]

export const ServerEvent = {
    RoomCreated: 'roomCreated',
    RoomClosed: 'roomClosed',
    Error: 'error',
} as const

export type ServerEvent = (typeof ServerEvent)[keyof typeof ServerEvent]

export const PeerEvent = {
    Disconnected: 'disconnected',
    Signal: 'signal',
    Broadcast: 'broadcast',
    Error: 'error',
    RateLimitExceeded: 'rate-limit-exceeded',
    Pong: 'pong',
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
    Kicked: 'Kicked from room',
    RoomFull: 'Room is full',
    WrongNode: 'Room owned by another node — reconnect to owner',
} as const

export type CloseReason = (typeof CloseReason)[keyof typeof CloseReason]

export type AuditEventType =
    | 'peer-joined'
    | 'peer-left'
    | 'peer-kicked'
    | 'room-created'
    | 'room-closed'

export interface AuditEvent {
    type: AuditEventType
    roomId: string
    peerId?: string
    ts: number
    detail?: Record<string, unknown>
}

export interface IceServerConfig {
    urls: string | string[]
    username?: string
    credential?: string
}

export interface SignalingServerOptions {
    port?: number
    server?: Server
    auth?: AuthFunction
    maxPeersPerRoom?: number
    roomMaxDurationMs?: number
    roomIdleTimeoutMs?: number
    pingInterval?: number
    pongTimeout?: number
    logger?: Logger
    metrics?: MetricsCollector
    serverAssignedPeerId?: boolean
    rateLimit?: {
        maxMessagesPerSecond?: number
    }
    auditLog?: (event: AuditEvent) => void
    iceServersHook?: (
        peerId: string,
        roomId: string,
    ) => IceServerConfig[] | null | undefined | Promise<IceServerConfig[] | null | undefined>
    cluster?: {
        selfId: string
        membership: Membership
    }
    onRedirect?: (peerId: string, roomId: string, owner: NodeInfo | undefined) => void
}
