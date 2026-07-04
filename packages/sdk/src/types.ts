import type { Logger } from 'rtcforge-core'
import type { BackoffStrategy } from './ReconnectStrategy.js'
import type { MessageQueue } from './SendQueue.js'
import type { Transport } from './Transport.js'
import type { ClientMessage } from './protocol.js'

/** No-op {@link Logger} implementation that discards all log records. */
export { noopLogger } from 'rtcforge-core'
export type { Logger }

/**
 * ICE server descriptor passed through to the browser's `RTCPeerConnection`.
 * Mirrors the shape of the standard `RTCIceServer` dictionary.
 */
export interface IceServerConfig {
    /** One or more STUN/TURN URLs, e.g. `"stun:stun.l.google.com:19302"`. */
    urls: string | string[]
    /** Username credential for a TURN server, if required. */
    username?: string
    /** Password/credential for a TURN server, if required. */
    credential?: string
}

/**
 * Construction options for a {@link Transport}. Passed by
 * {@link RTCForgeClient} to its {@link TransportFactory}; can also be supplied
 * directly when instantiating {@link WebSocketTransport} standalone.
 */
export interface TransportOptions {
    /**
     * Whether to automatically reconnect after an unexpected close.
     * @defaultValue `false` for {@link WebSocketTransport}; {@link RTCForgeClient} passes `true` by default.
     */
    reconnect?: boolean
    /**
     * Upper bound (ms) on the exponential-backoff reconnect delay.
     * @defaultValue `32000`
     */
    maxReconnectDelay?: number
    /** Maximum reconnect attempts before giving up; unlimited when omitted. */
    maxReconnectAttempts?: number
    /**
     * WebSocket close codes that must NOT trigger a reconnect — retrying would
     * be futile (e.g. a rejected/expired auth token closes with `1008`). On such
     * a close the transport emits {@link TransportEvent.Terminated} and stops.
     * @defaultValue `[1008]`
     */
    nonRetryableCloseCodes?: number[]
    /**
     * Timeout (ms) for a single connect attempt. `0` disables the timeout.
     * @defaultValue `10000`
     */
    connectTimeoutMs?: number
    /** Logger for connection lifecycle diagnostics. @defaultValue {@link noopLogger} */
    logger?: Logger
    /**
     * Async callback invoked before each reconnect to obtain a fresh auth
     * token, which is written to the `token` query parameter of the socket URL.
     */
    tokenRefresh?: () => Promise<string>
    /**
     * Maximum number of messages buffered while offline before sends are
     * rejected. Ignored when a custom {@link sendQueue} is supplied.
     * @defaultValue `100`
     */
    maxQueueSize?: number

    /** Custom backoff policy; defaults to a jittered exponential {@link ReconnectStrategy}. */
    reconnectStrategy?: BackoffStrategy

    /** Custom offline message buffer; defaults to a bounded {@link SendQueue}. */
    sendQueue?: MessageQueue<ClientMessage>
}

/**
 * Factory that builds a {@link Transport} for a given socket URL and options.
 * Override {@link RTCForgeClientOptions.transportFactory} to inject a custom or
 * mock transport (e.g. for testing).
 */
export type TransportFactory = (url: string, options: TransportOptions) => Transport

/** Configuration for constructing an {@link RTCForgeClient}. */
export interface RTCForgeClientOptions {
    /** Base signaling server URL (`ws://` or `wss://`); `roomId` and auth params are appended per join. */
    serverUrl: string
    /** Static auth token appended as the `token` query parameter. Takes precedence over {@link peerId}. */
    token?: string
    /** Async callback that yields a fresh token before each reconnect; forwarded to the transport. */
    tokenRefresh?: () => Promise<string>
    /** Explicit peer identifier, appended as `peerId` when no {@link token} is set. */
    peerId?: string
    /** Whether the transport reconnects automatically after a drop. @defaultValue `true` */
    reconnect?: boolean
    /** Upper bound (ms) on the reconnect backoff delay. @defaultValue `32000` */
    maxReconnectDelay?: number
    /** Maximum reconnect attempts before failing; unlimited when omitted. */
    maxReconnectAttempts?: number
    /**
     * Close codes that must NOT trigger a reconnect (retrying is futile, e.g. a
     * rejected/expired token → `1008`). Forwarded to the transport; on such a
     * close the client emits {@link ClientEvent.Terminated}. @defaultValue `[1008]`
     */
    nonRetryableCloseCodes?: number[]
    /** Timeout (ms) for a single connect attempt. */
    connectTimeoutMs?: number
    /** Maximum number of messages queued while offline. @defaultValue `100` */
    maxQueueSize?: number
    /** Timeout (ms) awaiting the `room-joined` handshake reply. @defaultValue `30000` */
    joinTimeoutMs?: number
    /** Logger for client and transport diagnostics. @defaultValue {@link noopLogger} */
    logger?: Logger
    /** Overrides the default {@link WebSocketTransport} factory. */
    transportFactory?: TransportFactory
}

/**
 * The connection lifecycle state of an {@link RTCForgeClient}, reflecting the
 * status of its underlying signaling {@link Transport}.
 */
export const ConnectionState = {
    /** Not connected: before the first join, or after {@link RTCForgeClient.leave} or a terminal close. */
    Disconnected: 'disconnected',
    /** A join is in progress and the initial handshake has not yet completed. */
    Connecting: 'connecting',
    /** The signaling socket is open and the room has been joined. */
    Connected: 'connected',
    /** The socket dropped and automatic reconnection is underway. */
    Reconnecting: 'reconnecting',
} as const

/** Union of the {@link ConnectionState} string values. */
export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState]

/** Adds, removes, and swaps local media tracks on an active call's peer connections. */
export interface CallTrackControl {
    /** Adds a local track to the call, associated with the given stream. */
    addTrack(track: MediaStreamTrack, stream: MediaStream): void
    /** Removes a previously added local track from the call. */
    removeTrack(track: MediaStreamTrack): void
    /** Replaces `oldTrack` with `newTrack` in place (e.g. camera switch) without renegotiation. */
    replaceTrack(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): Promise<void>
}

/** Toggles the enabled state of the local audio and video tracks on a call. */
export interface CallMuteControl {
    /** Disables the local audio track(s). */
    muteAudio(): void
    /** Re-enables the local audio track(s). */
    unmuteAudio(): void
    /** Disables the local video track(s). */
    muteVideo(): void
    /** Re-enables the local video track(s). */
    unmuteVideo(): void
    /** Returns `true` when local audio is currently muted. */
    isAudioMuted(): boolean
    /** Returns `true` when local video is currently muted. */
    isVideoMuted(): boolean
}

/** Exposes WebRTC statistics for a call. */
export interface CallStatsProvider {
    /**
     * Resolves with `RTCStatsReport`s keyed by peer id.
     * @param peerId - Restrict the report to a single peer; omit for all peers.
     */
    getStats(peerId?: string): Promise<Map<string, RTCStatsReport>>
}

/** Opens application data channels on a call's peer connections. */
export interface CallDataChannelFactory {
    /**
     * Creates a data channel on the connection to `peerId`.
     * @param peerId - The remote peer to open the channel to.
     * @param label - Channel label.
     * @param opts - Standard `RTCDataChannelInit` options.
     * @returns The channel, or `undefined` if no connection to `peerId` exists.
     */
    createDataChannel(
        peerId: string,
        label: string,
        opts?: RTCDataChannelInit,
    ): RTCDataChannel | undefined
}

/** Subscription surface for remote media streams arriving on a call. */
export interface RemoteStreamSource {
    /** Subscribes to a remote stream becoming available for a peer. */
    on(event: 'remote-stream', handler: (peerId: string, stream: MediaStream) => void): void
    /** Subscribes to a peer's remote stream being removed. */
    on(event: 'remote-stream-removed', handler: (peerId: string) => void): void
    /** Unsubscribes a previously registered `remote-stream` handler. */
    off(event: 'remote-stream', handler: (peerId: string, stream: MediaStream) => void): void
    /** Unsubscribes a previously registered `remote-stream-removed` handler. */
    off(event: 'remote-stream-removed', handler: (peerId: string) => void): void
}

/** Start/stop control for a call bound to a {@link Room}. */
export interface CallLifecycle {
    /** Begins negotiation and media flow for the call. */
    start(): void
    /** Tears the call down and releases its peer connections. */
    close(): void
}

/**
 * The minimal call surface a {@link Room} needs in order to manage media:
 * remote-stream subscription plus start/stop lifecycle. Passed to
 * {@link Room.bindCall}.
 */
export type BoundCall = RemoteStreamSource & CallLifecycle

/**
 * The full call abstraction combining track, mute, stats, data-channel,
 * remote-stream, and lifecycle capabilities. Implemented by the media layer
 * and consumed by the SDK through the narrower {@link BoundCall} view.
 */
export interface CallInterface
    extends CallTrackControl,
        CallMuteControl,
        CallStatsProvider,
        CallDataChannelFactory,
        RemoteStreamSource,
        CallLifecycle {}

/** Events emitted by a {@link Room} that concern the room itself rather than a specific peer message. */
export const RoomEvent = {
    /** The room was closed; the {@link Room} instance is no longer usable. */
    Closed: 'closed',
    /** The room roster was replaced after a reconnect/rejoin (peers, roles, metadata, ICE servers). */
    Refreshed: 'refreshed',
    /** A remote peer joined the room; the payload is the peer id string. */
    PeerJoined: 'peer-joined',
    /** A remote peer left the room; the payload is the peer id string. */
    PeerLeft: 'peer-left',
    /** A known peer regained its connection; the payload is the peer id string. */
    PresenceOnline: 'presence-online',
    /** A known peer lost its connection but has not left; the payload is the peer id string. */
    PresenceOffline: 'presence-offline',
    /** The local peer was kicked; the payload is `(peerId, reason)`. */
    Kicked: 'kicked',
    /** A directed peer-to-peer signaling payload arrived; the payload is `(from, data)`. */
    Signal: 'signal',
    /** A broadcast arrived on a named channel; the payload is `(from, channel, data)`. */
    Broadcast: 'broadcast',
    /** A peer's role changed; the payload is `(peerId, role)`. */
    RoleChanged: 'role-changed',
} as const

/** Union of the {@link RoomEvent} string values. */
export type RoomEvent = (typeof RoomEvent)[keyof typeof RoomEvent]

/** Lifecycle events emitted by an {@link RTCForgeClient}. */
export const ClientEvent = {
    /** The client joined the room and the signaling socket is open (also re-fires after a successful rejoin). */
    Connected: 'connected',
    /** The signaling socket closed; handler receives the close `code` and `reason`. */
    Disconnected: 'disconnected',
    /** A reconnect attempt started; handler receives the attempt number. */
    Reconnecting: 'reconnecting',
    /** A transport or server error occurred; handler receives an `Error`. */
    Error: 'error',
    /**
     * The connection is permanently terminated — a non-retryable close (e.g.
     * expired/rejected token, `code` 1008) or reconnect exhaustion. Handler
     * receives `code` and `reason`. The client resets so you can `joinRoom` again
     * (e.g. after refreshing credentials) without calling `leave()` first.
     */
    Terminated: 'terminated',
} as const

/** Union of the {@link ClientEvent} string values. */
export type ClientEvent = (typeof ClientEvent)[keyof typeof ClientEvent]

/** Events emitted by a {@link Transport} (see {@link TransportEvents} for handler signatures). */
export const TransportEvent = {
    /** The socket opened successfully. */
    Open: 'open',
    /** The socket closed; handler receives `code` and `reason`. */
    Close: 'close',
    /** A validated {@link ServerMessage} arrived. */
    Message: 'message',
    /** A transport error occurred; handler receives an `Error`. */
    Error: 'error',
    /** A reconnect attempt started; handler receives the attempt number. */
    Reconnecting: 'reconnecting',
    /**
     * The transport gave up permanently — either a non-retryable close code
     * (e.g. auth failure / expired token) or reconnect exhaustion. No further
     * reconnects will be attempted. Handler receives `code` and `reason`.
     */
    Terminated: 'terminated',
} as const

/** Union of the {@link TransportEvent} string values. */
export type TransportEvent = (typeof TransportEvent)[keyof typeof TransportEvent]

/** WebSocket close codes used by the transport. */
export const CloseCode = {
    /** Normal closure (RFC 6455 code 1000), sent when the client closes intentionally. */
    Normal: 1000,
    /**
     * Policy violation (RFC 6455 code 1008), sent by the server on auth failure,
     * rejected/expired token, rate/room-full rejection, or kick. Treated as
     * non-retryable by default (see {@link TransportOptions.nonRetryableCloseCodes}).
     */
    PolicyViolation: 1008,
} as const

/** Union of the {@link CloseCode} numeric values. */
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode]

/** Human-readable close reasons paired with a {@link CloseCode}. */
export const CloseReason = {
    /** Reason string accompanying a client-initiated normal close. */
    ClientClosed: 'Client closed',
} as const

/** Union of the {@link CloseReason} string values. */
export type CloseReason = (typeof CloseReason)[keyof typeof CloseReason]
