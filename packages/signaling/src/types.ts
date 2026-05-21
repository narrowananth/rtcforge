import type { Server } from 'node:http'
import { Metric, noopLogger, noopMetrics } from '@rtcforge/core'
import type { Logger, MetricsCollector } from '@rtcforge/core'
import { z } from 'zod'

export type { Logger, MetricsCollector }
export { noopLogger, noopMetrics, Metric }

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
    Signal: 'signal',
    Chat: 'chat',
    Typing: 'typing',
    Edit: 'edit',
    Delete: 'delete',
    Reaction: 'reaction',
    Read: 'read',
    WhiteboardEvent: 'whiteboard-event',
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
} as const

export type CloseReason = (typeof CloseReason)[keyof typeof CloseReason]

export interface SignalingServerOptions {
    port?: number
    server?: Server
    auth?: AuthFunction
    maxPeersPerRoom?: number
    pingInterval?: number
    pongTimeout?: number
    logger?: Logger
    metrics?: MetricsCollector
}
