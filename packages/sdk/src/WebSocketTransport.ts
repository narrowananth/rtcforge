import { EventEmitter } from './EventEmitter.js'
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
    private readonly logger: Logger
    private readonly tokenRefresh: (() => Promise<string>) | undefined

    constructor(
        url: string,
        options: {
            reconnect?: boolean
            maxReconnectDelay?: number
            maxReconnectAttempts?: number
            logger?: Logger
            tokenRefresh?: () => Promise<string>
        } = {},
    ) {
        super()
        this.url = url
        this.shouldReconnect = options.reconnect ?? true
        this.maxReconnectDelay = options.maxReconnectDelay ?? 32_000
        this.maxReconnectAttempts = options.maxReconnectAttempts
        this.logger = options.logger ?? noopLogger
        this.tokenRefresh = options.tokenRefresh
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.initSocket(resolve, reject)
        })
    }

    private static readonly WS_OPEN = 1

    send(msg: ClientMessage): void {
        if (this.ws?.readyState === WebSocketTransport.WS_OPEN) {
            this.ws.send(JSON.stringify(msg))
        }
    }

    close(): void {
        this._closed = true
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        this.ws?.close(CloseCode.Normal, CloseReason.ClientClosed)
    }

    private initSocket(onOpen?: () => void, onError?: (err: Error) => void): void {
        if (this._connecting) return
        this._connecting = true
        void this.getWsClass()
            .then((WS) => {
                this._connecting = false
                const ws = new WS(this.url)
                this.ws = ws

                let settled = false

                ws.onopen = () => {
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
                    } catch {
                        // ignore malformed messages
                    }
                }

                ws.onerror = () => {
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
        const delay = Math.min(1000 * 2 ** this.reconnectAttempt, this.maxReconnectDelay)
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

    private async getWsClass(): Promise<typeof WebSocket> {
        if (typeof globalThis.WebSocket !== 'undefined') {
            return globalThis.WebSocket
        }
        try {
            const { WebSocket: WS } = await import('ws')
            return WS as unknown as typeof globalThis.WebSocket
        } catch {
            throw new Error(
                'WebSocket is not available. Install the "ws" package or use Node.js >= 22.',
            )
        }
    }
}
