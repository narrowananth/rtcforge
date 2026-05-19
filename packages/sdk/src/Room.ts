import { ChatRoom } from './ChatRoom.js'
import { EventEmitter } from './EventEmitter.js'
import type { WebSocketTransport } from './WebSocketTransport.js'
import { WhiteboardRoom } from './WhiteboardRoom.js'
import { MessageType } from './protocol.js'
import type { ClientMessage, ServerMessage } from './protocol.js'
import { RoomEvent } from './types.js'
import type { CallInterface } from './types.js'

export const RoomMediaEvent = {
    PublishCamera: 'publish-camera',
    TrackAdded: 'track-added',
} as const

export type RoomMediaEvent = (typeof RoomMediaEvent)[keyof typeof RoomMediaEvent]

export interface PeerInfo {
    id: string
    joinedAt: number
}

type RoomEvents = {
    [MessageType.PeerJoined]: [peerId: string]
    [MessageType.PeerLeft]: [peerId: string]
    [MessageType.PresenceOnline]: [peerId: string]
    [MessageType.PresenceOffline]: [peerId: string]
    [MessageType.Kicked]: [peerId: string, reason: string | undefined]
    [MessageType.Signal]: [from: string, data: unknown]
    [RoomEvent.Closed]: []
    [RoomMediaEvent.PublishCamera]: [constraints: MediaStreamConstraints | undefined]
    [RoomMediaEvent.TrackAdded]: [
        track: MediaStreamTrack,
        streams: readonly MediaStream[],
        peerId: string,
    ]
}

export class Room extends EventEmitter<RoomEvents> {
    readonly id: string
    readonly localPeerId: string
    readonly chat: ChatRoom
    readonly whiteboard: WhiteboardRoom
    private readonly _peers = new Map<string, PeerInfo>()
    private readonly _transport: WebSocketTransport
    private _call: CallInterface | null = null

    constructor(
        id: string,
        localPeerId: string,
        initialPeers: string[],
        transport: WebSocketTransport,
    ) {
        super()
        this.id = id
        this.localPeerId = localPeerId
        this._seedPeers(localPeerId, initialPeers)
        this._transport = transport
        this.chat = new ChatRoom(transport)
        this.whiteboard = new WhiteboardRoom()
    }

    get peers(): string[] {
        return [...this._peers.keys()]
    }

    getPeerInfo(peerId: string): PeerInfo | undefined {
        return this._peers.get(peerId)
    }

    getPeerInfoAll(): PeerInfo[] {
        return [...this._peers.values()]
    }

    sendSignal(to: string, data: unknown): void {
        this._transport.send({ type: MessageType.Signal, to, data } satisfies ClientMessage)
    }

    bindCall(call: CallInterface): void {
        this._call?.close()
        this._call = call
        call.on('remote-stream', (peerId, stream) => {
            for (const track of stream.getTracks()) {
                this.emit(
                    RoomMediaEvent.TrackAdded,
                    track,
                    [stream] as readonly MediaStream[],
                    peerId,
                )
            }
        })
        call.start()
    }

    async publishCamera(constraints?: MediaStreamConstraints): Promise<MediaStream | undefined> {
        if (!this._call) return undefined
        const stream = await navigator.mediaDevices.getUserMedia(
            constraints ?? { video: true, audio: true },
        )
        if (!this._call) {
            for (const track of stream.getTracks()) track.stop()
            return undefined
        }
        for (const track of stream.getTracks()) {
            this._call.addTrack(track, stream)
        }
        this.emit(RoomMediaEvent.PublishCamera, constraints)
        return stream
    }

    _handleMessage(msg: ServerMessage): void {
        switch (msg.type) {
            case MessageType.PeerJoined:
                this._peers.set(msg.peerId, { id: msg.peerId, joinedAt: Date.now() })
                this.emit(MessageType.PeerJoined, msg.peerId)
                break
            case MessageType.PeerLeft:
                this._peers.delete(msg.peerId)
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
            case MessageType.Chat:
            case MessageType.Typing:
            case MessageType.History:
            case MessageType.Delivered:
            case MessageType.Read:
            case MessageType.Edited:
            case MessageType.Deleted:
            case MessageType.Reaction:
                this.chat._handleMessage(msg)
                break
        }
    }

    _refresh(localPeerId: string, peers: string[]): void {
        this._peers.clear()
        this._seedPeers(localPeerId, peers)
    }

    _close(): void {
        this._call?.close()
        this._call = null
        this.emit(RoomEvent.Closed)
    }

    private _seedPeers(localPeerId: string, peers: string[]): void {
        const now = Date.now()
        this._peers.set(localPeerId, { id: localPeerId, joinedAt: now })
        for (const p of peers) this._peers.set(p, { id: p, joinedAt: now })
    }
}
