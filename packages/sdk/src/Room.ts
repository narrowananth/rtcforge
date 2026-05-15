import { EventEmitter } from './EventEmitter.js'
import type { WebSocketTransport } from './WebSocketTransport.js'
import { MessageType } from './protocol.js'
import type { ClientMessage, ServerMessage } from './protocol.js'
import { RoomEvent } from './types.js'

type RoomEvents = {
    [MessageType.PeerJoined]: [peerId: string]
    [MessageType.PeerLeft]: [peerId: string]
    [MessageType.Signal]: [from: string, data: unknown]
    [RoomEvent.Closed]: []
}

export class Room extends EventEmitter<RoomEvents> {
    readonly id: string
    readonly localPeerId: string
    private readonly _peers = new Set<string>()
    private readonly _transport: WebSocketTransport

    constructor(
        id: string,
        localPeerId: string,
        initialPeers: string[],
        transport: WebSocketTransport,
    ) {
        super()
        this.id = id
        this.localPeerId = localPeerId
        this._peers.add(localPeerId)
        for (const p of initialPeers) this._peers.add(p)
        this._transport = transport
    }

    get peers(): string[] {
        return [...this._peers]
    }

    sendSignal(to: string, data: unknown): void {
        this._transport.send({ type: MessageType.Signal, to, data } satisfies ClientMessage)
    }

    _handleMessage(msg: ServerMessage): void {
        switch (msg.type) {
            case MessageType.PeerJoined:
                this._peers.add(msg.peerId)
                this.emit(MessageType.PeerJoined, msg.peerId)
                break
            case MessageType.PeerLeft:
                this._peers.delete(msg.peerId)
                this.emit(MessageType.PeerLeft, msg.peerId)
                break
            case MessageType.Signal:
                this.emit(MessageType.Signal, msg.from, msg.data)
                break
        }
    }

    _refresh(localPeerId: string, peers: string[]): void {
        this._peers.clear()
        this._peers.add(localPeerId)
        for (const p of peers) this._peers.add(p)
    }

    _close(): void {
        this.emit(RoomEvent.Closed)
    }
}
