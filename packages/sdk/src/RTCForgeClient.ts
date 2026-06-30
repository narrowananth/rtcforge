import { EventEmitter } from 'rtcforge-core'
import { JoinHandshake } from './JoinHandshake.js'
import { Room } from './Room.js'
import type { RoomControl } from './Room.js'
import type { Transport } from './Transport.js'
import { WebSocketTransport } from './WebSocketTransport.js'
import { MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { ClientEvent, ConnectionState, TransportEvent } from './types.js'
import type { RTCForgeClientOptions, TransportFactory } from './types.js'

type ClientEvents = {
    [ClientEvent.Connected]: []
    [ClientEvent.Disconnected]: [code: number, reason: string]
    [ClientEvent.Reconnecting]: [attempt: number]
    [ClientEvent.Error]: [err: Error]
}

const defaultTransportFactory: TransportFactory = (url, options) =>
    new WebSocketTransport(url, options)

const LEGAL_TRANSITIONS: Record<ConnectionState, readonly ConnectionState[]> = {
    [ConnectionState.Disconnected]: [ConnectionState.Connecting, ConnectionState.Reconnecting],
    [ConnectionState.Connecting]: [
        ConnectionState.Connected,
        ConnectionState.Disconnected,
        ConnectionState.Reconnecting,
    ],
    [ConnectionState.Connected]: [ConnectionState.Reconnecting, ConnectionState.Disconnected],
    [ConnectionState.Reconnecting]: [ConnectionState.Connected, ConnectionState.Disconnected],
}

export class RTCForgeClient extends EventEmitter<ClientEvents> {
    private readonly opts: RTCForgeClientOptions
    private readonly _transportFactory: TransportFactory
    private transport: Transport | null = null
    private room: Room | null = null
    private control: RoomControl | null = null
    private _handshake: JoinHandshake | null = null
    private _cleanups: Array<() => void> = []
    private _connectionState: ConnectionState = ConnectionState.Disconnected

    constructor(opts: RTCForgeClientOptions) {
        super()
        this.opts = opts
        this._transportFactory = opts.transportFactory ?? defaultTransportFactory
    }

    get connectionState(): ConnectionState {
        return this._connectionState
    }

    async joinRoom(roomId: string): Promise<Room> {
        if (this._connectionState === ConnectionState.Connecting)
            throw new Error('joinRoom already in progress')
        if (this.transport !== null) throw new Error('Already in a room — call leave() first')

        this._setState(ConnectionState.Connecting)

        const transport = this._transportFactory(this.buildUrl(roomId), {
            reconnect: this.opts.reconnect ?? true,
            maxReconnectDelay: this.opts.maxReconnectDelay ?? 32_000,
            maxReconnectAttempts: this.opts.maxReconnectAttempts,
            connectTimeoutMs: this.opts.connectTimeoutMs,
            maxQueueSize: this.opts.maxQueueSize,
            logger: this.opts.logger,
            tokenRefresh: this.opts.tokenRefresh,
        })
        this.transport = transport
        this._wireLifecycle(transport)

        const handshake = new JoinHandshake(transport, this.opts.joinTimeoutMs ?? 30_000)
        this._handshake = handshake

        try {
            const joined = await handshake.run()
            this._handshake = null

            if (this.transport !== transport) {
                transport.close()
                throw new Error('joinRoom cancelled by leave()')
            }

            this._setState(ConnectionState.Connected)
            const { room, control } = Room.create({
                id: joined.roomId,
                localPeerId: joined.peerId,
                peers: joined.peers,
                transport,
                localRole: joined.localRole,
                iceServers: joined.iceServers,
                peerRoles: joined.peerRoles,
                peerMetadata: joined.peerMetadata,
            })
            this.room = room
            this.control = control
            this._attachSteadyState(transport, control)
            transport.flush()
            this.emit(ClientEvent.Connected)
            return room
        } catch (err) {
            this._handshake = null
            this._setState(ConnectionState.Disconnected)
            for (const cleanup of this._cleanups) cleanup()
            this._cleanups = []
            transport.close()
            if (this.transport === transport) this.transport = null
            throw err
        }
    }

    async leave(): Promise<void> {
        this._handshake?.cancel('joinRoom cancelled by leave()')
        this._handshake = null
        this._setState(ConnectionState.Disconnected)
        for (const cleanup of this._cleanups) cleanup()
        this._cleanups = []
        this.control?.close()
        this.control = null
        this.room = null
        this.transport?.close()
        this.transport = null
    }

    private _setState(next: ConnectionState): boolean {
        if (this._connectionState === next) return true
        if (!LEGAL_TRANSITIONS[this._connectionState].includes(next)) {
            this.opts.logger?.warn?.('Ignoring illegal connection-state transition', {
                from: this._connectionState,
                to: next,
            })
            return false
        }
        this._connectionState = next
        return true
    }

    private _wireLifecycle(transport: Transport): void {
        const onClose = (code: number, reason: string) => {
            this._setState(ConnectionState.Disconnected)
            this.emit(ClientEvent.Disconnected, code, reason)
        }
        const onReconnecting = (attempt: number) => {
            this._setState(ConnectionState.Reconnecting)
            this.emit(ClientEvent.Reconnecting, attempt)
        }
        const onError = (err: Error) => this.emit(ClientEvent.Error, err)

        transport.on(TransportEvent.Close, onClose)
        transport.on(TransportEvent.Reconnecting, onReconnecting)
        transport.on(TransportEvent.Error, onError)
        this._cleanups.push(
            () => transport.off(TransportEvent.Close, onClose),
            () => transport.off(TransportEvent.Reconnecting, onReconnecting),
            () => transport.off(TransportEvent.Error, onError),
        )
    }

    private _attachSteadyState(transport: Transport, control: RoomControl): void {
        const onMessage = (msg: ServerMessage) => {
            if (msg.type === MessageType.RoomJoined) {
                if (!this._setState(ConnectionState.Connected)) return
                control.refresh({
                    localPeerId: msg.peerId,
                    peers: msg.peers,
                    peerRoles: msg.peerRoles,
                    localRole: msg.localRole,
                    iceServers: msg.iceServers,
                    peerMetadata: msg.peerMetadata,
                })
                transport.flush()
                this.emit(ClientEvent.Connected)
            } else if (msg.type === MessageType.Error) {
                this.emit(ClientEvent.Error, new Error(msg.message))
            } else {
                control.handleMessage(msg)
            }
        }
        transport.on(TransportEvent.Message, onMessage)
        this._cleanups.push(() => transport.off(TransportEvent.Message, onMessage))
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
