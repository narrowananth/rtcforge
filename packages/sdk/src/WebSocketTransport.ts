import { EventEmitter, toError } from '@rtcforge/core'
import { MessageType, ServerMessageSchema } from './protocol.js'
import type { ClientMessage, ServerMessage } from './protocol.js'
import { CloseCode, CloseReason, TransportEvent, noopLogger } from './types.js'
import type { Logger } from './types.js'

type TransportEvents = {
    [TransportEvent.Open]: []
    [TransportEvent.Close]: [code: number, reason: string]
    [TransportEvent.Message]: [data: ServerMessage]
    [TransportEvent.Error]: [err: Error]
    [TransportEvent.Reconnecting]: [attempt: number]
}

export class WebSocketTransport extends EventEmitter<TransportEvents> {
    private ws: WebSocket | null = null
    private reconnectAttempt = 0
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private _closed = false
    private _connecting = false

    private url: string
    private readonly shouldReconnect: boolean
    private readonly maxReconnectDelay: number
    private readonly maxReconnectAttempts: number | undefined
    private readonly connectTimeoutMs: number | undefined
    private readonly logger: Logger
    private readonly tokenRefresh: (() => Promise<string>) | undefined
    private readonly _maxQueueSize: number | undefined
    private readonly _sendQueue: ClientMessage[] = []

    constructor(
        url: string,
        options: {
            reconnect?: boolean
            maxReconnectDelay?: number
            maxReconnectAttempts?: number
            connectTimeoutMs?: number
            logger?: Logger
            tokenRefresh?: () => Promise<string>
            maxQueueSize?: number
        } = {},
    ) {
        super()
        this.url = url
        this.shouldReconnect = options.reconnect ?? false
        this.maxReconnectDelay = options.maxReconnectDelay ?? 32_000
        this.maxReconnectAttempts = options.maxReconnectAttempts
        this.connectTimeoutMs = options.connectTimeoutMs
        this.logger = options.logger ?? noopLogger
        this.tokenRefresh = options.tokenRefresh
        this._maxQueueSize = options.maxQueueSize
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.initSocket(resolve, reject)
        })
    }

    private static readonly WS_OPEN = 1

    send(msg: ClientMessage): void {
        if (this._closed) return
        if (this.ws?.readyState === WebSocketTransport.WS_OPEN) {
            if (this._sendQueue.length > 0) this._flushQueue()
            this.ws.send(JSON.stringify(msg))
        } else {
            if (this._sendQueue.length >= (this._maxQueueSize ?? 100)) {
                this.emit(TransportEvent.Error, new Error('Send queue full'))
                return
            }
            this._sendQueue.push(msg)
        }
    }

    private _flushQueue(): void {
        if (this.ws?.readyState !== WebSocketTransport.WS_OPEN) return
        for (const msg of this._sendQueue) {
            this.ws.send(JSON.stringify(msg))
        }
        this._sendQueue.length = 0
    }

    close(): void {
        this._closed = true
        this._sendQueue.length = 0
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        this.ws?.close(CloseCode.Normal, CloseReason.ClientClosed)
    }

    flush(): void {
        this._flushQueue()
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
                              ws.close()
                              if (!settled) {
                                  settled = true
                                  onError?.(new Error('WebSocket connect timeout'))
                              }
                          }, connectTimeoutMs ?? 10_000)
                        : null

                ws.onopen = () => {
                    if (connectTimer) clearTimeout(connectTimer)
                    this.reconnectAttempt = 0
                    this.logger.info('WebSocket connected', { url: this.url })
                    this.emit(TransportEvent.Open)
                    if (!settled) {
                        settled = true
                        onOpen?.()
                    }
                }

                ws.onclose = (ev) => {
                    const code = ev.code ?? 1006
                    const reason = String(ev.reason ?? '')
                    this.logger.info('WebSocket closed', { code, reason })
                    this.emit(TransportEvent.Close, code, reason)
                    if (!this._closed && this.shouldReconnect) {
                        if (
                            this.maxReconnectAttempts !== undefined &&
                            this.reconnectAttempt >= this.maxReconnectAttempts
                        ) {
                            this.logger.warn('Max reconnect attempts reached', {
                                attempts: this.reconnectAttempt,
                            })
                            this._closed = true
                            const exhaustedErr = new Error('Max reconnect attempts reached')
                            this.emit(TransportEvent.Error, exhaustedErr)
                            if (!settled) {
                                settled = true
                                onError?.(exhaustedErr)
                            }
                            return
                        }
                        this.scheduleReconnect()
                    }
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
                    this.logger.error('WebSocket error', { url: this.url })
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
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer)
        }
        const base = Math.min(1000 * 2 ** this.reconnectAttempt, this.maxReconnectDelay)
        const delay = base + base * 0.3 * Math.random()
        this.reconnectAttempt++
        this.logger.info('Reconnecting', { attempt: this.reconnectAttempt, delay })
        this.emit(TransportEvent.Reconnecting, this.reconnectAttempt)
        this.reconnectTimer = setTimeout(() => {
            if (this.tokenRefresh) {
                this.tokenRefresh()
                    .then((newToken) => {
                        const u = new URL(this.url)
                        u.searchParams.set('token', newToken)
                        this.url = u.toString()
                        this.initSocket()
                    })
                    .catch((err: Error) => {
                        this.logger.warn('Token refresh failed', { err: err.message })
                        this.initSocket()
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
