import { EventEmitter, toError } from '@rtcforge/core'
import { WebSocket } from 'ws'
import { ClientMessageSchema, MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { PeerEvent } from './types.js'

type PeerEvents = {
    [PeerEvent.Disconnected]: [code: number, reason: string]
    [PeerEvent.Signal]: [to: string, data: unknown]
    [PeerEvent.Broadcast]: [channel: string, data: unknown]
    [PeerEvent.Error]: [err: Error]
    [PeerEvent.RateLimitExceeded]: []
}

type RateLimit = { maxPerSec: number; count: number; windowStart: number }

export class Peer extends EventEmitter<PeerEvents> {
    readonly id: string
    private _role: string
    readonly metadata: Record<string, string>
    lastPong: number

    private readonly ws: WebSocket
    private readonly onSignal: (to: string, data: unknown) => void
    private readonly _rateLimit: RateLimit | null

    constructor(
        id: string,
        role: string,
        ws: WebSocket,
        onSignal: (to: string, data: unknown) => void,
        metadata: Record<string, string> = {},
        maxMessagesPerSecond?: number,
    ) {
        super()
        this.id = id
        this._role = role
        this.metadata = metadata
        this.ws = ws
        this.onSignal = onSignal
        this.lastPong = Date.now()
        this._rateLimit =
            maxMessagesPerSecond !== undefined
                ? { maxPerSec: maxMessagesPerSecond, count: 0, windowStart: Date.now() }
                : null

        this.ws.on('message', (raw) => this.handleMessage(raw.toString()))
        this.ws.on('close', (code, reason) => {
            this.emit(PeerEvent.Disconnected, code, reason.toString())
        })
    }

    get role(): string {
        return this._role
    }

    setRole(role: string): void {
        this._role = role
    }

    isAlive(deadline: number): boolean {
        return this.lastPong >= deadline
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
        } catch {
            // no-op: peer already disconnected
        }
    }

    disconnect(code: number, reason: string): void {
        this.ws.close(code, reason)
    }

    private handleMessage(raw: string): void {
        const now = Date.now()
        if (this._rateLimit !== null) {
            if (now - this._rateLimit.windowStart >= 1000) {
                this._rateLimit.count = 0
                this._rateLimit.windowStart = now
            }
            if (this._rateLimit.count >= this._rateLimit.maxPerSec) {
                this.emit(PeerEvent.RateLimitExceeded)
                return
            }
            this._rateLimit.count++
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
                this.lastPong = now
                break
            case MessageType.Broadcast:
                this.emit(PeerEvent.Broadcast, msg.channel, msg.data ?? null)
                break
        }
    }
}
