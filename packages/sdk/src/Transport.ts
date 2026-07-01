import type { EventEmitter } from 'rtcforge-core'
import type { ClientMessage, ServerMessage } from './protocol.js'
import { TransportEvent } from './types.js'

/**
 * Maps each {@link TransportEvent} to its handler argument tuple, giving the
 * {@link Transport} event emitter fully typed `on`/`once`/`off` signatures.
 */
export type TransportEvents = {
    /** Socket opened; no arguments. */
    [TransportEvent.Open]: []
    /** Socket closed; carries the WebSocket close `code` and `reason`. */
    [TransportEvent.Close]: [code: number, reason: string]
    /** A validated inbound {@link ServerMessage} was received. */
    [TransportEvent.Message]: [data: ServerMessage]
    /** A transport error occurred. */
    [TransportEvent.Error]: [err: Error]
    /** A reconnect attempt began; carries the 1-based attempt number. */
    [TransportEvent.Reconnecting]: [attempt: number]
}

/**
 * The signaling channel abstraction between {@link RTCForgeClient} and the
 * server. {@link WebSocketTransport} is the default implementation; provide an
 * alternative through {@link RTCForgeClientOptions.transportFactory} to swap in
 * a different socket or a test double.
 *
 * @remarks
 * A transport owns connection lifecycle, offline message queuing, and
 * reconnection. It emits {@link TransportEvents} and only surfaces messages that
 * pass schema validation.
 */
export interface Transport extends Pick<EventEmitter<TransportEvents>, 'on' | 'once' | 'off'> {
    /** Opens the connection, resolving when the socket is open and rejecting on failure/timeout. */
    connect(): Promise<void>
    /** Sends a message immediately if connected, otherwise buffers it in the send queue. */
    send(msg: ClientMessage): void
    /** Flushes any queued messages to the open socket. Called after (re)join to drain the offline buffer. */
    flush(): void
    /** Closes the connection permanently, clears the queue, and cancels any pending reconnect. */
    close(): void
}
