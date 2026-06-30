import { EventEmitter, toError } from '@rtcforge/core'
import { MessageType } from './protocol.js'
import type { ClientMessage, ServerMessage } from './protocol.js'
import { RoomEvent } from './types.js'
import type { BoundCall, IceServerConfig } from './types.js'

export const RoomMediaEvent = {
    TrackAdded: 'track-added',
    Error: 'media-error',
} as const

export type RoomMediaEvent = (typeof RoomMediaEvent)[keyof typeof RoomMediaEvent]

export interface PeerInfo {
    id: string
}

export interface RoomTransport {
    send(msg: ClientMessage): void
}

export interface RoomInit {
    id: string
    localPeerId: string
    peers: string[]
    transport: RoomTransport
    localRole?: string
    iceServers?: IceServerConfig[]
    peerRoles?: Record<string, string>
    peerMetadata?: Record<string, Record<string, string>>
}

export interface RoomRefresh {
    localPeerId: string
    peers: string[]
    peerRoles?: Record<string, string>
    localRole?: string
    iceServers?: IceServerConfig[]
    peerMetadata?: Record<string, Record<string, string>>
}

export interface RoomControl {
    handleMessage(msg: ServerMessage): void
    refresh(params: RoomRefresh): void
    close(): void
}

type RoomEvents = {
    [MessageType.PeerJoined]: [peerId: string]
    [MessageType.PeerLeft]: [peerId: string]
    [MessageType.PresenceOnline]: [peerId: string]
    [MessageType.PresenceOffline]: [peerId: string]
    [MessageType.Kicked]: [peerId: string, reason: string | undefined]
    [MessageType.Signal]: [from: string, data: unknown]
    [MessageType.Broadcast]: [from: string, channel: string, data: unknown]
    [MessageType.RoleChanged]: [peerId: string, role: string]
    [RoomEvent.Closed]: []
    [RoomEvent.Refreshed]: []
    [RoomMediaEvent.TrackAdded]: [
        track: MediaStreamTrack,
        streams: readonly MediaStream[],
        peerId: string,
    ]
    [RoomMediaEvent.Error]: [err: Error]
}

type RemoteStreamHandler = (peerId: string, stream: MediaStream) => void

export class Room extends EventEmitter<RoomEvents> {
    readonly id: string
    readonly localPeerId: string
    private readonly _peers = new Map<string, PeerInfo>()
    private readonly _peerRoles = new Map<string, string>()
    private readonly _peerMeta = new Map<string, Record<string, string>>()
    private readonly _transport: RoomTransport
    private _call: BoundCall | null = null
    private _callStreamHandler: RemoteStreamHandler | null = null
    private _closed = false
    private _localPeerRole: string | undefined
    private _iceServers: readonly IceServerConfig[]

    private constructor(init: RoomInit) {
        super()
        this.id = init.id
        this.localPeerId = init.localPeerId
        this._localPeerRole = init.localRole
        this._iceServers = init.iceServers ?? []
        this._transport = init.transport
        this._seedPeers(init.localPeerId, init.peers)
        if (init.peerRoles) this._initRoles(init.peerRoles)
        if (init.peerMetadata) this._initMeta(init.peerMetadata)
    }

    static create(init: RoomInit): { room: Room; control: RoomControl } {
        const room = new Room(init)
        const control: RoomControl = {
            handleMessage: (msg) => room._handleMessage(msg),
            refresh: (params) => room._refresh(params),
            close: () => room._close(),
        }
        return { room, control }
    }

    get localPeerRole(): string | undefined {
        return this._localPeerRole
    }

    get iceServers(): readonly IceServerConfig[] {
        return this._iceServers
    }

    get peers(): string[] {
        return [...this._peers.keys()]
    }

    get isClosed(): boolean {
        return this._closed
    }

    hasPeer(peerId: string): boolean {
        return this._peers.has(peerId)
    }

    getPeerRole(peerId: string): string | undefined {
        return this._peerRoles.get(peerId)
    }

    getPeerMetadata(peerId: string): Record<string, string> | undefined {
        const meta = this._peerMeta.get(peerId)
        return meta ? { ...meta } : undefined
    }

    getPeerInfo(peerId: string): PeerInfo | undefined {
        return this._peers.get(peerId)
    }

    getPeerInfoAll(): PeerInfo[] {
        return [...this._peers.values()]
    }

    sendSignal(to: string, data: unknown): void {
        this._trySend({ type: MessageType.Signal, to, data } satisfies ClientMessage)
    }

    broadcast(channel: string, data?: unknown): void {
        this._trySend({ type: MessageType.Broadcast, channel, data } satisfies ClientMessage)
    }

    private _trySend(msg: ClientMessage): void {
        try {
            this._transport.send(msg)
        } catch (err) {
            this.emit(RoomMediaEvent.Error, toError(err))
        }
    }

    bindCall(call: BoundCall): void {
        this._unbindCall()
        this._call = call
        const handler: RemoteStreamHandler = (peerId, stream) => {
            const streams = [stream] as readonly MediaStream[]
            for (const track of stream.getTracks()) {
                this.emit(RoomMediaEvent.TrackAdded, track, streams, peerId)
            }
        }
        this._callStreamHandler = handler
        call.on('remote-stream', handler)
        call.start()
    }

    private _unbindCall(): void {
        if (this._call && this._callStreamHandler) {
            this._call.off('remote-stream', this._callStreamHandler)
        }
        this._call?.close()
        this._call = null
        this._callStreamHandler = null
    }

    private _handleMessage(msg: ServerMessage): void {
        switch (msg.type) {
            case MessageType.PeerJoined:
                this._peers.set(msg.peerId, { id: msg.peerId })
                if (msg.role) this._peerRoles.set(msg.peerId, msg.role)
                if (msg.metadata) this._peerMeta.set(msg.peerId, { ...msg.metadata })
                this.emit(MessageType.PeerJoined, msg.peerId)
                break
            case MessageType.PeerLeft:
                this._peers.delete(msg.peerId)
                this._peerRoles.delete(msg.peerId)
                this._peerMeta.delete(msg.peerId)
                this.emit(MessageType.PeerLeft, msg.peerId)
                break
            case MessageType.PresenceOnline:
                this.emit(MessageType.PresenceOnline, msg.peerId)
                break
            case MessageType.PresenceOffline:
                this.emit(MessageType.PresenceOffline, msg.peerId)
                break
            case MessageType.Kicked:
                this.emit(MessageType.Kicked, msg.peerId, msg.reason)
                break
            case MessageType.Signal:
                this.emit(MessageType.Signal, msg.from, msg.data)
                break
            case MessageType.Broadcast:
                this.emit(MessageType.Broadcast, msg.from, msg.channel, msg.data ?? null)
                break
            case MessageType.RoleChanged:
                this._peerRoles.set(msg.peerId, msg.role)
                this.emit(MessageType.RoleChanged, msg.peerId, msg.role)
                break
        }
    }

    private _initRoles(peerRoles: Record<string, string>): void {
        for (const [id, role] of Object.entries(peerRoles)) {
            this._peerRoles.set(id, role)
        }
    }

    private _initMeta(peerMetadata: Record<string, Record<string, string>>): void {
        for (const [id, meta] of Object.entries(peerMetadata)) {
            this._peerMeta.set(id, { ...meta })
        }
    }

    private _refresh(params: RoomRefresh): void {
        this._peers.clear()
        this._peerRoles.clear()
        this._seedPeers(params.localPeerId, params.peers)
        if (params.peerRoles) this._initRoles(params.peerRoles)
        if (params.localRole !== undefined) this._localPeerRole = params.localRole
        if (params.iceServers !== undefined) this._iceServers = params.iceServers
        if (params.peerMetadata !== undefined) {
            this._peerMeta.clear()
            this._initMeta(params.peerMetadata)
        }
        this.emit(RoomEvent.Refreshed)
    }

    private _close(): void {
        this._closed = true
        this._unbindCall()
        this.emit(RoomEvent.Closed)
    }

    private _seedPeers(localPeerId: string, peers: string[]): void {
        this._peers.set(localPeerId, { id: localPeerId })
        for (const p of peers) this._peers.set(p, { id: p })
    }
}
