import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { ClientMessageSchema, MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { PeerEvent } from './types.js'
import type { PeerRole } from './types.js'

export declare interface Peer {
    on(event: typeof PeerEvent.Disconnected, listener: (code: number, reason: string) => void): this
    once(
        event: typeof PeerEvent.Disconnected,
        listener: (code: number, reason: string) => void,
    ): this
    emit(event: typeof PeerEvent.Disconnected, code: number, reason: string): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter overload pattern
export class Peer extends EventEmitter {
    readonly id: string
    readonly role: PeerRole
    lastPong: number

    private readonly ws: WebSocket
    private readonly onSignal: (to: string, data: unknown) => void

    constructor(
        id: string,
        role: PeerRole,
        ws: WebSocket,
        onSignal: (to: string, data: unknown) => void,
    ) {
        super()
        this.id = id
        this.role = role
        this.ws = ws
        this.onSignal = onSignal
        this.lastPong = Date.now()

        this.ws.on('message', (raw) => this.handleMessage(raw.toString()))
        this.ws.on('close', (code, reason) => {
            this.emit(PeerEvent.Disconnected, code, reason.toString())
        })
    }

    send(msg: ServerMessage): void {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg))
        }
    }

    ping(): void {
        this.send({ type: MessageType.Ping })
    }

    disconnect(code: number, reason: string): void {
        this.ws.close(code, reason)
    }

    private handleMessage(raw: string): void {
        let parsed: unknown
        try {
            parsed = JSON.parse(raw)
        } catch {
            return
        }
        const result = ClientMessageSchema.safeParse(parsed)
        if (!result.success) return
        const msg = result.data
        switch (msg.type) {
            case MessageType.Signal:
                this.onSignal(msg.to, msg.data)
                break
            case MessageType.Pong:
                this.lastPong = Date.now()
                break
        }
    }
}
