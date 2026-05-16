import { EventEmitter } from './EventEmitter.js'
import { Room } from './Room.js'
import { WebSocketTransport } from './WebSocketTransport.js'
import { MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { ClientEvent, TransportEvent } from './types.js'
import type { RTCForgeClientOptions } from './types.js'

type ClientEvents = {
    [ClientEvent.Connected]: []
    [ClientEvent.Disconnected]: [code: number, reason: string]
    [ClientEvent.Reconnecting]: [attempt: number]
    [ClientEvent.Error]: [err: Error]
}

export class RTCForgeClient extends EventEmitter<ClientEvents> {
    private readonly opts: RTCForgeClientOptions
    private transport: WebSocketTransport | null = null
    private room: Room | null = null
    private messageHandler: ((msg: ServerMessage) => void) | null = null

    constructor(opts: RTCForgeClientOptions) {
        super()
        this.opts = opts
    }

    joinRoom(roomId: string): Promise<Room> {
        const url = this.buildUrl(roomId)

        const transport = new WebSocketTransport(url, {
            reconnect: this.opts.reconnect ?? true,
            maxReconnectDelay: this.opts.maxReconnectDelay ?? 32_000,
            maxReconnectAttempts: this.opts.maxReconnectAttempts,
            logger: this.opts.logger,
        })
        this.transport = transport

        transport.on(TransportEvent.Close, (code, reason) => {
            this.emit(ClientEvent.Disconnected, code, reason)
        })

        transport.on(TransportEvent.Reconnecting, (attempt) => {
            this.emit(ClientEvent.Reconnecting, attempt)
        })

        transport.on(TransportEvent.Error, (err) => {
            this.emit(ClientEvent.Error, err)
        })

        return new Promise<Room>((resolve, reject) => {
            let settled = false

            const handleMessage = (msg: ServerMessage) => {
                if (!settled) {
                    if (msg.type === MessageType.RoomJoined) {
                        settled = true
                        this.room = new Room(msg.roomId, msg.peerId, msg.peers, transport)
                        this.emit(ClientEvent.Connected)
                        resolve(this.room)
                    } else if (msg.type === MessageType.Error) {
                        settled = true
                        reject(new Error(msg.message))
                    }
                    return
                }

                if (!this.room) return

                if (msg.type === MessageType.RoomJoined) {
                    this.room._refresh(msg.peerId, msg.peers)
                    this.emit(ClientEvent.Connected)
                    return
                }

                this.room._handleMessage(msg)
            }

            this.messageHandler = handleMessage
            transport.on(TransportEvent.Message, handleMessage)

            transport.connect().catch((err: Error) => {
                if (!settled) {
                    settled = true
                    reject(err)
                }
            })
        })
    }

    async leave(): Promise<void> {
        if (this.messageHandler && this.transport) {
            this.transport.off(TransportEvent.Message, this.messageHandler)
        }
        this.messageHandler = null
        this.room?._close()
        this.room = null
        this.transport?.close()
        this.transport = null
    }

    private buildUrl(roomId: string): string {
        const url = new URL(this.opts.serverUrl)
        url.searchParams.set('roomId', roomId)
        if (this.opts.token) {
            url.searchParams.set('token', this.opts.token)
        }
        return url.toString()
    }
}
