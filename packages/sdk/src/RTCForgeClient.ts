import { EventEmitter } from '@rtcforge/core'
import { Room } from './Room.js'
import { WebSocketTransport } from './WebSocketTransport.js'
import { MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { ClientEvent, ConnectionState, TransportEvent } from './types.js'
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
    private _transportCleanups: Array<() => void> = []
    private _connectionState: ConnectionState = ConnectionState.Disconnected
    private _joinRoomReject: ((err: Error) => void) | null = null

    constructor(opts: RTCForgeClientOptions) {
        super()
        this.opts = opts
    }

    get connectionState(): ConnectionState {
        return this._connectionState
    }

    joinRoom(roomId: string): Promise<Room> {
        if (this._connectionState === ConnectionState.Connecting)
            throw new Error('joinRoom already in progress')
        if (this.transport !== null) throw new Error('Already in a room — call leave() first')
        this._connectionState = ConnectionState.Connecting

        const url = this.buildUrl(roomId)

        const transport = new WebSocketTransport(url, {
            reconnect: this.opts.reconnect ?? true,
            maxReconnectDelay: this.opts.maxReconnectDelay ?? 32_000,
            maxReconnectAttempts: this.opts.maxReconnectAttempts,
            connectTimeoutMs: this.opts.connectTimeoutMs,
            maxQueueSize: this.opts.maxQueueSize,
            logger: this.opts.logger,
            tokenRefresh: this.opts.tokenRefresh,
        })
        this.transport = transport

        const onClose = (code: number, reason: string) => {
            this._connectionState = ConnectionState.Disconnected
            this.emit(ClientEvent.Disconnected, code, reason)
        }
        const onReconnecting = (attempt: number) => {
            this._connectionState = ConnectionState.Reconnecting
            this.emit(ClientEvent.Reconnecting, attempt)
        }
        const onError = (err: Error) => {
            this.emit(ClientEvent.Error, err)
        }
        transport.on(TransportEvent.Close, onClose)
        transport.on(TransportEvent.Reconnecting, onReconnecting)
        transport.on(TransportEvent.Error, onError)

        return new Promise<Room>((resolve, reject) => {
            this._joinRoomReject = reject
            let settled = false
            let joinTimer: ReturnType<typeof setTimeout> | null = null

            const settle = (fn: () => void) => {
                if (settled) return
                settled = true
                this._joinRoomReject = null
                if (joinTimer) {
                    clearTimeout(joinTimer)
                    joinTimer = null
                }
                fn()
            }

            const handleMessage = (msg: ServerMessage) => {
                if (!settled) {
                    if (msg.type === MessageType.RoomJoined) {
                        settle(() => {
                            if (this.transport !== transport) {
                                transport.close()
                                reject(new Error('joinRoom cancelled by leave()'))
                                return
                            }
                            this._connectionState = ConnectionState.Connected
                            this.room = new Room(
                                msg.roomId,
                                msg.peerId,
                                msg.peers,
                                transport,
                                msg.localRole,
                                msg.iceServers,
                            )
                            if (msg.peerRoles) this.room._initRoles(msg.peerRoles)
                            if (msg.peerMetadata) this.room._initMeta(msg.peerMetadata)
                            transport.flush()
                            this.emit(ClientEvent.Connected)
                            resolve(this.room)
                        })
                    } else if (msg.type === MessageType.Error) {
                        settle(() => {
                            this._connectionState = ConnectionState.Disconnected
                            transport.close()
                            this.transport = null
                            reject(new Error(msg.message))
                        })
                    }
                    return
                }

                if (!this.room) return

                if (msg.type === MessageType.RoomJoined) {
                    this._connectionState = ConnectionState.Connected
                    this.room._refresh(
                        msg.peerId,
                        msg.peers,
                        msg.peerRoles,
                        msg.localRole,
                        msg.iceServers,
                        msg.peerMetadata,
                    )
                    transport.flush()
                    this.emit(ClientEvent.Connected)
                    return
                }

                if (msg.type === MessageType.Error) {
                    this.emit(ClientEvent.Error, new Error(msg.message))
                    return
                }

                this.room._handleMessage(msg)
            }

            transport.on(TransportEvent.Message, handleMessage)
            this._transportCleanups = [
                () => transport.off(TransportEvent.Message, handleMessage),
                () => transport.off(TransportEvent.Close, onClose),
                () => transport.off(TransportEvent.Reconnecting, onReconnecting),
                () => transport.off(TransportEvent.Error, onError),
            ]

            const effectiveJoinTimeout = this.opts.joinTimeoutMs ?? 30_000
            if (effectiveJoinTimeout > 0) {
                transport.once(TransportEvent.Open, () => {
                    if (!settled) {
                        joinTimer = setTimeout(() => {
                            settle(() => {
                                this._connectionState = ConnectionState.Disconnected
                                transport.close()
                                this.transport = null
                                reject(new Error('joinRoom timeout: no RoomJoined received'))
                            })
                        }, effectiveJoinTimeout)
                    }
                })
            }

            transport.connect().catch((err: Error) => {
                settle(() => {
                    this._connectionState = ConnectionState.Disconnected
                    transport.close()
                    this.transport = null
                    reject(err)
                })
            })
        })
    }

    async leave(): Promise<void> {
        this._joinRoomReject?.(new Error('joinRoom cancelled by leave()'))
        this._joinRoomReject = null
        this._connectionState = ConnectionState.Disconnected
        for (const cleanup of this._transportCleanups) cleanup()
        this._transportCleanups = []
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
        } else if (this.opts.peerId) {
            url.searchParams.set('peerId', this.opts.peerId)
        }
        return url.toString()
    }
}
