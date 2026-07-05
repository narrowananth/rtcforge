import { EventEmitter, toError } from 'rtcforge-core'
import { ReconnectStrategy } from './ReconnectStrategy.js'
import type { BackoffStrategy } from './ReconnectStrategy.js'
import { SendQueue } from './SendQueue.js'
import type { MessageQueue } from './SendQueue.js'
import type { Transport, TransportEvents } from './Transport.js'
import { MessageType, ServerMessageSchema } from './protocol.js'
import type { ClientMessage } from './protocol.js'
import { CloseCode, CloseReason, TransportEvent, noopLogger } from './types.js'
import type { Logger, TransportOptions } from './types.js'

const WS_OPEN = 1

/**
 * Default WebSocket-based {@link Transport}.
 *
 * @remarks
 * Handles the full connection lifecycle: it resolves a `WebSocket`
 * implementation (the global one in browsers/Node ≥ 22, falling back to the
 * `ws` package), validates every inbound frame against
 * `ServerMessageSchema` and silently drops invalid ones, and answers
 * server `ping` frames with `pong` automatically. Messages sent while the socket
 * is not open are buffered in a {@link MessageQueue} and flushed on reconnect.
 * When {@link TransportOptions.reconnect} is enabled it retries using a
 * {@link BackoffStrategy}, optionally refreshing the auth token via
 * {@link TransportOptions.tokenRefresh} before each attempt, and gives up once
 * the strategy is exhausted.
 *
 * @example
 * ```ts
 * const transport = new WebSocketTransport('wss://example.com/rtc?roomId=demo', {
 *   reconnect: true,
 *   maxReconnectDelay: 32_000,
 * })
 * transport.on('message', (msg) => console.log(msg))
 * await transport.connect()
 * ```
 */
export class WebSocketTransport extends EventEmitter<TransportEvents> implements Transport {
    private ws: WebSocket | null = null
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private _closed = false
    private _exhausted = false
    private _connecting = false

    private url: string
    private readonly shouldReconnect: boolean
    private readonly connectTimeoutMs: number | undefined
    private readonly logger: Logger
    private readonly tokenRefresh: (() => Promise<string>) | undefined
    private readonly _queue: MessageQueue<ClientMessage>
    private readonly _reconnect: BackoffStrategy
    private readonly _nonRetryable: Set<number>

    /**
     * @param url - Full signaling socket URL including any auth/room query parameters.
     * @param options - Reconnect, timeout, logging, token-refresh, and queue configuration.
     */
    constructor(url: string, options: TransportOptions = {}) {
        super()
        this.url = url
        this.shouldReconnect = options.reconnect ?? false
        this.connectTimeoutMs = options.connectTimeoutMs
        this.logger = options.logger ?? noopLogger
        this.tokenRefresh = options.tokenRefresh
        this._queue = options.sendQueue ?? new SendQueue(options.maxQueueSize ?? 100, this.logger)
        this._reconnect =
            options.reconnectStrategy ??
            new ReconnectStrategy(options.maxReconnectDelay ?? 32_000, options.maxReconnectAttempts)
        this._nonRetryable = new Set(options.nonRetryableCloseCodes ?? [CloseCode.PolicyViolation])
    }

    /**
     * The socket URL with the `token` query parameter redacted, so auth tokens
     * are never written to logs or proxy/aggregator sinks. Use for all logging.
     */
    private get _safeUrl(): string {
        try {
            const u = new URL(this.url)
            if (u.searchParams.has('token')) u.searchParams.set('token', 'REDACTED')
            return u.toString()
        } catch {
            return this.url
        }
    }

    private get isTerminal(): boolean {
        return this._closed || this._exhausted
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.initSocket(resolve, reject)
        })
    }

    send(msg: ClientMessage): void {
        if (this.isTerminal) return
        if (this.ws?.readyState === WS_OPEN) {
            if (this._queue.size > 0) this.flush()
            this.ws.send(JSON.stringify(msg))
        } else if (!this._queue.enqueue(msg)) {
            this.emit(TransportEvent.Error, new Error('Send queue full'))
        }
    }

    flush(): void {
        if (this.ws?.readyState !== WS_OPEN) return
        const ws = this.ws
        this._queue.drain((m) => ws.send(JSON.stringify(m)))
    }

    close(): void {
        this._closed = true
        this._queue.clear()
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        this.ws?.close(CloseCode.Normal, CloseReason.ClientClosed)
    }

    private initSocket(onOpen?: () => void, onError?: (err: Error) => void): void {
        if (this._connecting) {
            onError?.(new Error('Connection already in progress'))
            return
        }
        this._connecting = true
        void this.getWsClass()
            .then((WS) => {
                this._connecting = false
                if (this._closed) return
                const ws = new WS(this.url)
                this.ws = ws

                let settled = false

                const connectTimeoutMs = this.connectTimeoutMs
                const connectTimer =
                    connectTimeoutMs !== 0
                        ? setTimeout(() => {
                              if (settled) return
                              settled = true
                              // Mark terminal BEFORE close() so the onclose that
                              // ws.close() re-enters sees isTerminal and cannot
                              // schedule a spurious reconnect for a connect that
                              // already timed out and rejected.
                              this._exhausted = true
                              ws.close()
                              onError?.(new Error('WebSocket connect timeout'))
                          }, connectTimeoutMs ?? 10_000)
                        : null

                ws.onopen = () => {
                    if (connectTimer) clearTimeout(connectTimer)
                    this._reconnect.reset()
                    this.logger.info('WebSocket connected', { url: this._safeUrl })
                    this.emit(TransportEvent.Open)
                    // Flush any frames buffered while offline, as documented
                    // ("buffered ... and flushed on reconnect").
                    this.flush()
                    if (!settled) {
                        settled = true
                        onOpen?.()
                    }
                }

                ws.onclose = (ev) => {
                    if (connectTimer) clearTimeout(connectTimer)
                    const code = ev.code ?? 1006
                    const reason = String(ev.reason ?? '')
                    this.logger.info('WebSocket closed', { code, reason })
                    this.emit(TransportEvent.Close, code, reason)
                    if (this.isTerminal || !this.shouldReconnect) return
                    // A non-retryable close (default: 1008, e.g. rejected/expired
                    // token) would loop forever against the same dead credential.
                    // Terminate instead of reconnecting, and surface it distinctly.
                    if (this._nonRetryable.has(code)) {
                        this.logger.warn('Non-retryable close — giving up', { code, reason })
                        this._exhausted = true
                        this.emit(TransportEvent.Terminated, code, reason)
                        if (!settled) {
                            settled = true
                            onError?.(new Error(`Connection closed (${code}): ${reason}`))
                        }
                        return
                    }
                    if (this._reconnect.isExhausted()) {
                        this.logger.warn('Max reconnect attempts reached', {
                            attempts: this._reconnect.attempt,
                        })
                        this._exhausted = true
                        const exhaustedErr = new Error('Max reconnect attempts reached')
                        this.emit(TransportEvent.Error, exhaustedErr)
                        this.emit(TransportEvent.Terminated, code, reason)
                        if (!settled) {
                            settled = true
                            onError?.(exhaustedErr)
                        }
                        return
                    }
                    this.scheduleReconnect()
                }

                ws.onmessage = (ev) => {
                    try {
                        const parsed: unknown = JSON.parse(String(ev.data))
                        const result = ServerMessageSchema.safeParse(parsed)
                        if (!result.success) return
                        const msg = result.data
                        if (msg.type === MessageType.Ping) {
                            this.send({ type: MessageType.Pong })
                            return
                        }
                        this.emit(TransportEvent.Message, msg)
                    } catch (err) {
                        this.emit(TransportEvent.Error, toError(err))
                    }
                }

                ws.onerror = () => {
                    if (connectTimer) clearTimeout(connectTimer)
                    const err = new Error('WebSocket error')
                    this.logger.error('WebSocket error', { url: this._safeUrl })
                    this.emit(TransportEvent.Error, err)
                    if (!settled) {
                        settled = true
                        onError?.(err)
                    }
                }
            })
            .catch((err: Error) => {
                this._connecting = false
                if (onError) {
                    onError(err)
                } else {
                    this.emit(TransportEvent.Error, err)
                }
            })
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
        const delay = this._reconnect.nextDelay()
        this.logger.info('Reconnecting', { attempt: this._reconnect.attempt, delay })
        this.emit(TransportEvent.Reconnecting, this._reconnect.attempt)
        this._armReconnectTimer(delay)
    }

    private _armReconnectTimer(delay: number): void {
        this.reconnectTimer = setTimeout(() => {
            if (this.isTerminal) return

            if (this._connecting) {
                this._armReconnectTimer(delay)
                return
            }
            if (this.tokenRefresh) {
                this.tokenRefresh()
                    .then((newToken) => {
                        const u = new URL(this.url)
                        u.searchParams.set('token', newToken)
                        this.url = u.toString()
                        this.initSocket()
                    })
                    .catch((err: Error) => {
                        // Do NOT reconnect with the stale (expired) token — the
                        // server would close 1008 (non-retryable) and terminate
                        // permanently over a transient token-service blip. Treat
                        // it as a retryable failure and schedule another attempt.
                        this.logger.warn(
                            'Token refresh failed; skipping reconnect with stale token, will retry',
                            { err: err.message },
                        )
                        if (this.isTerminal) return
                        if (this._reconnect.isExhausted()) {
                            this.logger.warn('Max reconnect attempts reached', {
                                attempts: this._reconnect.attempt,
                            })
                            this._exhausted = true
                            this.emit(
                                TransportEvent.Error,
                                new Error('Max reconnect attempts reached'),
                            )
                            this.emit(TransportEvent.Terminated, 1006, 'Token refresh failed')
                            return
                        }
                        this.scheduleReconnect()
                    })
            } else {
                this.initSocket()
            }
        }, delay)
    }

    private _wsClass: typeof WebSocket | null = null

    private async getWsClass(): Promise<typeof WebSocket> {
        if (this._wsClass) return this._wsClass
        if (typeof globalThis.WebSocket !== 'undefined') {
            this._wsClass = globalThis.WebSocket
            return this._wsClass
        }
        try {
            const { WebSocket: WS } = await import('ws')
            this._wsClass = WS as unknown as typeof globalThis.WebSocket
            return this._wsClass
        } catch {
            throw new Error(
                'WebSocket is not available. Install the "ws" package or use Node.js >= 22.',
            )
        }
    }
}
