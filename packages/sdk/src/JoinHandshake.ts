import type { Transport } from './Transport.js'
import { MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { TransportEvent } from './types.js'

type RoomJoinedMessage = Extract<ServerMessage, { type: typeof MessageType.RoomJoined }>

/**
 * Drives the connect-and-join exchange, resolving once the server confirms the room.
 *
 * @remarks
 * {@link JoinHandshake.run | run} connects the {@link Transport} and waits for a
 * `RoomJoined` frame, rejecting on an `Error` frame or after `joinTimeoutMs`. The
 * message listener stays attached after settling and buffers any frames that
 * arrive in the same batch as `RoomJoined` (the transport can deliver several
 * synchronously); those are replayed to steady-state handling via
 * {@link JoinHandshake.drain | drain}.
 */
export class JoinHandshake {
    private _settled = false
    private _timer: ReturnType<typeof setTimeout> | null = null
    private _onMessage: ((msg: ServerMessage) => void) | null = null
    private _reject: ((err: Error) => void) | null = null
    private _buffer: ServerMessage[] = []

    constructor(
        private readonly transport: Transport,
        private readonly joinTimeoutMs: number,
    ) {}

    run(): Promise<RoomJoinedMessage> {
        return new Promise<RoomJoinedMessage>((resolve, reject) => {
            this._reject = reject

            const onMessage = (msg: ServerMessage) => {
                // After a successful join the listener stays attached and buffers
                // any frames that arrive before steady-state handling is wired up
                // (ws can deliver room-joined and a following signal/peer-joined
                // synchronously in one batch). Those are replayed via drain().
                if (this._settled) {
                    this._buffer.push(msg)
                    return
                }
                if (msg.type === MessageType.RoomJoined) {
                    this._settled = true
                    if (this._timer !== null) {
                        clearTimeout(this._timer)
                        this._timer = null
                    }
                    resolve(msg)
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

    /**
     * Detach the handshake listener and replay any frames buffered between the
     * `room-joined` settle and now, so no early signal is lost. Call once, after
     * the steady-state message handler is attached.
     */
    drain(handler: (msg: ServerMessage) => void): void {
        this._detach()
        const buffered = this._buffer
        this._buffer = []
        for (const msg of buffered) handler(msg)
    }

    /** Detach the listener and drop any buffered frames without replaying them. */
    dispose(): void {
        this._detach()
        this._buffer = []
    }

    cancel(reason: string): void {
        this._settle(() => this._reject?.(new Error(reason)))
    }

    private _detach(): void {
        if (this._onMessage !== null) {
            this.transport.off(TransportEvent.Message, this._onMessage)
            this._onMessage = null
        }
    }

    private _settle(fn: () => void): void {
        if (this._settled) return
        this._settled = true
        if (this._timer !== null) {
            clearTimeout(this._timer)
            this._timer = null
        }
        this._detach()
        fn()
    }
}
