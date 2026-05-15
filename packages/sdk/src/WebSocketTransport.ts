import { EventEmitter } from './EventEmitter.js'
import { MessageType, ServerMessageSchema } from './protocol.js'
import type { ClientMessage, ServerMessage } from './protocol.js'
import { CloseCode, CloseReason, TransportEvent } from './types.js'

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

    private readonly url: string
    private readonly shouldReconnect: boolean
    private readonly maxReconnectDelay: number

    constructor(url: string, options: { reconnect?: boolean; maxReconnectDelay?: number } = {}) {
        super()
        this.url = url
        this.shouldReconnect = options.reconnect ?? true
        this.maxReconnectDelay = options.maxReconnectDelay ?? 32_000
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
        void this.getWsClass()
            .then((WS) => {
                const ws = new WS(this.url)
                this.ws = ws

                let settled = false

                ws.onopen = () => {
                    this.reconnectAttempt = 0
                    this.emit(TransportEvent.Open)
                    if (!settled) {
                        settled = true
                        onOpen?.()
                    }
                }

                ws.onclose = (ev) => {
                    this.emit(TransportEvent.Close, ev.code ?? 1006, String(ev.reason ?? ''))
                    if (!this._closed && this.shouldReconnect) {
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
                    this.emit(TransportEvent.Error, err)
                    if (!settled) {
                        settled = true
                        onError?.(err)
                    }
                }
            })
            .catch((err: Error) => {
                if (onError) {
                    onError(err)
                } else {
                    this.emit('error', err)
                }
            })
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer)
        }
        const delay = Math.min(1000 * 2 ** this.reconnectAttempt, this.maxReconnectDelay)
        this.reconnectAttempt++
        this.emit(TransportEvent.Reconnecting, this.reconnectAttempt)
        this.reconnectTimer = setTimeout(() => {
            this.initSocket()
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
