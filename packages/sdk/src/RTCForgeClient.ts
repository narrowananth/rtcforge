import { EventEmitter } from 'rtcforge-core'
import { JoinHandshake } from './JoinHandshake.js'
import { Room } from './Room.js'
import type { RoomControl } from './Room.js'
import type { Transport } from './Transport.js'
import { WebSocketTransport } from './WebSocketTransport.js'
import { MessageType, PROTOCOL_VERSION } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { ClientEvent, ConnectionState, TransportEvent } from './types.js'
import type { RTCForgeClientOptions, TransportFactory } from './types.js'

type ClientEvents = {
    [ClientEvent.Connected]: []
    [ClientEvent.Disconnected]: [code: number, reason: string]
    [ClientEvent.Reconnecting]: [attempt: number]
    [ClientEvent.Error]: [err: Error]
    [ClientEvent.Terminated]: [code: number, reason: string]
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
    private _room: Room | null = null
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

    /**
     * The currently joined {@link Room}, or `null` when not in a room. Lets you
     * reach the room without holding onto the {@link RTCForgeClient.joinRoom}
     * return value.
     */
    get room(): Room | null {
        return this._room
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
            nonRetryableCloseCodes: this.opts.nonRetryableCloseCodes,
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

            // Fail-fast visibility on a protocol skew (server older/newer than us).
            if (joined.v !== undefined && joined.v !== PROTOCOL_VERSION) {
                this.opts.logger?.warn?.('Signaling protocol version mismatch', {
                    server: joined.v,
                    client: PROTOCOL_VERSION,
                })
            }

            if (this.transport !== transport) {
                handshake.dispose()
                this._handshake = null
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
            this._room = room
            this.control = control
            const onMessage = this._attachSteadyState(transport, control)
            // Replay any frames buffered during the handshake→steady-state gap
            // (and detach the handshake listener) before flushing outbound sends.
            handshake.drain(onMessage)
            this._handshake = null
            transport.flush()
            this.emit(ClientEvent.Connected)
            return room
        } catch (err) {
            handshake.dispose()
            transport.close()
            // Only mutate shared client state if THIS join still owns the transport.
            // A re-join started from within a Terminated/Disconnected handler (the
            // documented re-auth pattern) installs a new transport; this stale
            // catch must not clobber it.
            if (this.transport === transport) {
                this._handshake = null
                this._setState(ConnectionState.Disconnected)
                for (const cleanup of this._cleanups) cleanup()
                this._cleanups = []
                this.transport = null
            }
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
        this._room = null
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
        // The transport gave up permanently (non-retryable close or exhaustion).
        // Reset the client so a fresh joinRoom works without a leave() first, and
        // surface a distinct terminal signal the app can act on (e.g. re-auth).
        const onTerminated = (code: number, reason: string) => {
            // Cancel an in-flight join (terminated after socket-open but before
            // room-joined) so the awaiting joinRoom() rejects now instead of
            // hanging until joinTimeoutMs.
            this._handshake?.cancel(`connection terminated (${code}): ${reason}`)
            this._handshake = null
            for (const cleanup of this._cleanups) cleanup()
            this._cleanups = []
            this.control?.close()
            this.control = null
            this._room = null
            this.transport = null
            this._setState(ConnectionState.Disconnected)
            this.emit(ClientEvent.Terminated, code, reason)
        }

        transport.on(TransportEvent.Close, onClose)
        transport.on(TransportEvent.Reconnecting, onReconnecting)
        transport.on(TransportEvent.Error, onError)
        transport.on(TransportEvent.Terminated, onTerminated)
        this._cleanups.push(
            () => transport.off(TransportEvent.Close, onClose),
            () => transport.off(TransportEvent.Reconnecting, onReconnecting),
            () => transport.off(TransportEvent.Error, onError),
            () => transport.off(TransportEvent.Terminated, onTerminated),
        )
    }

    private _attachSteadyState(
        transport: Transport,
        control: RoomControl,
    ): (msg: ServerMessage) => void {
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
        return onMessage
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
