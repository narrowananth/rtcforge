import type { Transport } from './Transport.js'
import { MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { TransportEvent } from './types.js'

type RoomJoinedMessage = Extract<ServerMessage, { type: typeof MessageType.RoomJoined }>

export class JoinHandshake {
    private _settled = false
    private _timer: ReturnType<typeof setTimeout> | null = null
    private _onMessage: ((msg: ServerMessage) => void) | null = null
    private _reject: ((err: Error) => void) | null = null

    constructor(
        private readonly transport: Transport,
        private readonly joinTimeoutMs: number,
    ) {}

    run(): Promise<RoomJoinedMessage> {
        return new Promise<RoomJoinedMessage>((resolve, reject) => {
            this._reject = reject

            const onMessage = (msg: ServerMessage) => {
                if (msg.type === MessageType.RoomJoined) {
                    this._settle(() => resolve(msg))
                } else if (msg.type === MessageType.Error) {
                    this._settle(() => reject(new Error(msg.message)))
                }
            }
            this._onMessage = onMessage
            this.transport.on(TransportEvent.Message, onMessage)

            if (this.joinTimeoutMs > 0) {
                this._timer = setTimeout(() => {
                    this._settle(() =>
                        reject(new Error('joinRoom timeout: no RoomJoined received')),
                    )
                }, this.joinTimeoutMs)
            }

            this.transport.connect().catch((err: Error) => this._settle(() => reject(err)))
        })
    }

    cancel(reason: string): void {
        this._settle(() => this._reject?.(new Error(reason)))
    }

    private _settle(fn: () => void): void {
        if (this._settled) return
        this._settled = true
        if (this._timer !== null) {
            clearTimeout(this._timer)
            this._timer = null
        }
        if (this._onMessage !== null) {
            this.transport.off(TransportEvent.Message, this._onMessage)
            this._onMessage = null
        }
        fn()
    }
}
