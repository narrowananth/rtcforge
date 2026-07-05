import { EventEmitter, toError } from 'rtcforge-core'
import { WebSocket } from 'ws'
import { RateLimiter } from './RateLimiter.js'
import { ClientMessageSchema, MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { CloseCode, CloseReason, PeerEvent } from './types.js'

/** Default cap on the WebSocket send buffer before a slow consumer is dropped (16 MiB). */
const DEFAULT_MAX_BUFFERED_BYTES = 16 * 1024 * 1024

/** Truncate a string so its UTF-8 encoding fits within `maxBytes` (for ws close reasons). */
function truncateUtf8(s: string, maxBytes: number): string {
    if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s
    let out = s
    while (Buffer.byteLength(out, 'utf8') > maxBytes) out = out.slice(0, -1)
    // Slicing UTF-16 code units can strand an unpaired high surrogate (the low
    // half of a pair was dropped). A lone surrogate is invalid UTF-8, so drop it.
    if (out.length > 0) {
        const last = out.charCodeAt(out.length - 1)
        if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
    }
    return out
}

type PeerEvents = {
    [PeerEvent.Disconnected]: [code: number, reason: string]
    [PeerEvent.Signal]: [to: string, data: unknown]
    [PeerEvent.Broadcast]: [channel: string, data: unknown]
    [PeerEvent.Error]: [err: Error]
    [PeerEvent.RateLimitExceeded]: []
    [PeerEvent.Pong]: []
}

/**
 * Construction options for a {@link Peer}.
 */
export interface PeerOptions {
    /** Stable identifier for the peer. */
    id: string
    /** The peer's open WebSocket connection. */
    ws: WebSocket
    /** Callback invoked when the peer sends a directed `signal`, used to relay it. */
    onSignal: (to: string, data: unknown) => void
    /** Optional initial role. @defaultValue `''` */
    role?: string
    /** Optional immutable metadata attached to the peer at join time. */
    metadata?: Record<string, string>
    /** When set, caps inbound messages per second; excess ones are dropped. */
    maxMessagesPerSecond?: number
    /**
     * Cap on the WebSocket's outbound buffered bytes. If a send would push
     * `ws.bufferedAmount` past this, the peer is disconnected instead of
     * buffering more (bounds slow-consumer / broadcast-amplification DoS).
     * @defaultValue 16 MiB
     */
    maxBufferedBytes?: number
}

/**
 * A single connected client within a {@link Room}.
 *
 * @remarks
 * Wraps the underlying WebSocket: it parses and validates inbound
 * {@link ClientMessage}s, applies optional per-peer rate limiting, tracks the
 * last heartbeat pong for liveness, and serializes outbound
 * {@link ServerMessage}s. It extends the core `EventEmitter` and emits
 * {@link PeerEvent} values (`signal`, `broadcast`, `pong`, `error`,
 * `rate-limit-exceeded`, `disconnected`). Peers are created and owned by
 * {@link SignalingServer}; you usually obtain them via {@link Room.getPeers}.
 */
export class Peer extends EventEmitter<PeerEvents> {
    /** Stable identifier for this peer. */
    readonly id: string
    /** Immutable (frozen) copy of the metadata supplied at join time. */
    readonly metadata: Record<string, string>

    private _role: string
    private _lastPong: number
    private _admitted = false
    private readonly ws: WebSocket
    private readonly onSignal: (to: string, data: unknown) => void
    private readonly _rateLimiter: RateLimiter | null
    private readonly _maxBufferedBytes: number

    /**
     * Wraps an open WebSocket as a peer and begins listening for inbound
     * messages and the socket `close` event.
     *
     * @param opts - Peer configuration; see `PeerOptions`.
     */
    constructor(opts: PeerOptions) {
        super()
        this.id = opts.id
        this._role = opts.role ?? ''

        this.metadata = Object.freeze({ ...(opts.metadata ?? {}) })
        this.ws = opts.ws
        this.onSignal = opts.onSignal
        this._lastPong = Date.now()
        this._rateLimiter =
            opts.maxMessagesPerSecond !== undefined
                ? new RateLimiter(opts.maxMessagesPerSecond)
                : null
        this._maxBufferedBytes = opts.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES

        this.ws.on('message', (raw) => this.handleMessage(raw.toString()))
        this.ws.on('close', (code, reason) => {
            this.emit(PeerEvent.Disconnected, code, reason.toString())
        })
        // A raw socket 'error' (ECONNRESET, malformed frame) is emitted on the
        // ws EventEmitter; with no listener Node throws uncaughtException and
        // kills the whole server. Surface it and let 'close' drive cleanup.
        this.ws.on('error', (err) => {
            this.emit(PeerEvent.Error, toError(err))
        })
    }

    /**
     * The peer's current role. Empty string if none was assigned.
     */
    get role(): string {
        return this._role
    }

    /**
     * Epoch-millisecond timestamp of the peer's most recent heartbeat pong
     * (initialized to construction time). Used by the heartbeat monitor to prune
     * unresponsive peers.
     */
    get lastPong(): number {
        return this._lastPong
    }

    /**
     * Sets the peer's role.
     *
     * @remarks
     * Updates local state only; use {@link Room.setPeerRole} to also notify the
     * rest of the room.
     *
     * @param role - The new role string.
     */
    setRole(role: string): void {
        this._role = role
    }

    /**
     * Marks the peer as admitted to its room.
     *
     * @remarks
     * Called by {@link SignalingServer} only after the peer has been successfully
     * added to a {@link Room}. Until then, inbound `signal` and `broadcast`
     * frames are ignored so an un-admitted (or about-to-be-rejected) peer cannot
     * relay or broadcast during the async admission window.
     */
    admit(): void {
        this._admitted = true
    }

    /**
     * Reports whether the peer has ponged recently enough to be considered live.
     *
     * @param deadline - Cutoff timestamp in epoch milliseconds; the peer is
     *   alive if its last pong is at or after this value.
     * @returns `true` if the peer is still considered connected.
     */
    isAlive(deadline: number): boolean {
        return this._lastPong >= deadline
    }

    /**
     * Serializes and sends a message to the peer over its WebSocket.
     *
     * @param msg - The server message to send.
     * @throws If the WebSocket is not open, or if the underlying send fails
     *   (which also emits {@link PeerEvent.Error}).
     */
    send(msg: ServerMessage): void {
        if (this.ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Peer ${this.id} WebSocket is not open`)
        }
        // Backpressure: a slow/malicious consumer that never drains its socket
        // makes the server buffer without bound (amplified by broadcast fan-out).
        // Drop the peer instead of buffering more.
        if (this.ws.bufferedAmount > this._maxBufferedBytes) {
            this.emit(
                PeerEvent.Error,
                new Error(
                    `Peer ${this.id} exceeded max buffered bytes ` +
                        `(${this.ws.bufferedAmount} > ${this._maxBufferedBytes}); disconnecting`,
                ),
            )
            this.disconnect(CloseCode.PolicyViolation, CloseReason.SendBufferOverflow)
            return
        }
        try {
            this.ws.send(JSON.stringify(msg))
        } catch (err) {
            const error = toError(err)
            this.emit(PeerEvent.Error, error)
            throw error
        }
    }

    ping(): void {
        try {
            this.send({ type: MessageType.Ping })
        } catch {}
    }

    disconnect(code: number, reason: string): void {
        // A WebSocket close reason must be ≤123 UTF-8 bytes or ws.close() throws.
        this.ws.close(code, truncateUtf8(reason, 123))
    }

    private handleMessage(raw: string): void {
        // Rate-limit BEFORE parsing so malformed-frame and pong floods are bounded
        // too (not just valid app messages) — the earlier "parse first, exempt
        // pong" ordering left both unbounded.
        if (this._rateLimiter !== null && !this._rateLimiter.allow()) {
            this.emit(PeerEvent.RateLimitExceeded)
            return
        }
        // Any accepted frame proves liveness, so a peer sending real traffic is
        // never falsely pruned by the heartbeat even if a pong is rate-limited —
        // this replaces the fragile pong-exemption without leaving pongs unbounded.
        this._lastPong = Date.now()

        let parsed: unknown
        try {
            parsed = JSON.parse(raw)
        } catch (err) {
            this.emit(PeerEvent.Error, new Error(`JSON parse error: ${String(err)}`))
            return
        }
        const result = ClientMessageSchema.safeParse(parsed)
        if (!result.success) {
            this.emit(
                PeerEvent.Error,
                new Error(`Parse error: ${JSON.stringify(result.error.issues)}`),
            )
            return
        }
        const msg = result.data
        switch (msg.type) {
            case MessageType.Signal:
                // Ignore relay/broadcast frames until the peer is admitted to a
                // room, so an un-admitted (or rejected) peer cannot relay during
                // the async admission window.
                if (!this._admitted) return
                this.onSignal(msg.to, msg.data)
                this.emit(PeerEvent.Signal, msg.to, msg.data)
                break
            case MessageType.Pong:
                this._lastPong = Date.now()
                this.emit(PeerEvent.Pong)
                break
            case MessageType.Broadcast:
                if (!this._admitted) return
                this.emit(PeerEvent.Broadcast, msg.channel, msg.data ?? null)
                break
        }
    }
}
