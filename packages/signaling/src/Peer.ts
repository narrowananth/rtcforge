import { EventEmitter, toError } from 'rtcforge-core'
import { WebSocket } from 'ws'
import { RateLimiter } from './RateLimiter.js'
import { ClientMessageSchema, MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { PeerEvent } from './types.js'

type PeerEvents = {
    [PeerEvent.Disconnected]: [code: number, reason: string]
    [PeerEvent.Signal]: [to: string, data: unknown]
    [PeerEvent.Broadcast]: [channel: string, data: unknown]
    [PeerEvent.Error]: [err: Error]
    [PeerEvent.RateLimitExceeded]: []
    [PeerEvent.Pong]: []
}

export interface PeerOptions {
    id: string
    ws: WebSocket
    onSignal: (to: string, data: unknown) => void
    role?: string
    metadata?: Record<string, string>
    maxMessagesPerSecond?: number
}

export class Peer extends EventEmitter<PeerEvents> {
    readonly id: string
    readonly metadata: Record<string, string>

    private _role: string
    private _lastPong: number
    private readonly ws: WebSocket
    private readonly onSignal: (to: string, data: unknown) => void
    private readonly _rateLimiter: RateLimiter | null

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

        this.ws.on('message', (raw) => this.handleMessage(raw.toString()))
        this.ws.on('close', (code, reason) => {
            this.emit(PeerEvent.Disconnected, code, reason.toString())
        })
    }

    get role(): string {
        return this._role
    }

    get lastPong(): number {
        return this._lastPong
    }

    setRole(role: string): void {
        this._role = role
    }

    isAlive(deadline: number): boolean {
        return this._lastPong >= deadline
    }

    send(msg: ServerMessage): void {
        if (this.ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Peer ${this.id} WebSocket is not open`)
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
        this.ws.close(code, reason)
    }

    private handleMessage(raw: string): void {
        if (this._rateLimiter !== null && !this._rateLimiter.allow()) {
            this.emit(PeerEvent.RateLimitExceeded)
            return
        }

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
                this.onSignal(msg.to, msg.data)
                this.emit(PeerEvent.Signal, msg.to, msg.data)
                break
            case MessageType.Pong:
                this._lastPong = Date.now()
                this.emit(PeerEvent.Pong)
                break
            case MessageType.Broadcast:
                this.emit(PeerEvent.Broadcast, msg.channel, msg.data ?? null)
                break
        }
    }
}
