import { EventEmitter } from 'node:events'
import type { Peer } from './Peer.js'
import { MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { CloseCode, CloseReason, PeerEvent, RoomEvent, RoomState } from './types.js'

export declare interface Room {
    on(event: typeof RoomEvent.PeerJoined, listener: (peer: Peer) => void): this
    on(event: typeof RoomEvent.PeerLeft, listener: (peer: Peer) => void): this
    on(event: typeof RoomEvent.Closed, listener: () => void): this
    once(event: typeof RoomEvent.PeerJoined, listener: (peer: Peer) => void): this
    once(event: typeof RoomEvent.PeerLeft, listener: (peer: Peer) => void): this
    once(event: typeof RoomEvent.Closed, listener: () => void): this
    emit(event: typeof RoomEvent.PeerJoined, peer: Peer): boolean
    emit(event: typeof RoomEvent.PeerLeft, peer: Peer): boolean
    emit(event: typeof RoomEvent.Closed): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter overload pattern
export class Room extends EventEmitter {
    readonly id: string
    private _state: RoomState = RoomState.Active
    private readonly _peers = new Map<string, Peer>()

    constructor(id: string) {
        super()
        this.id = id
    }

    get state(): RoomState {
        return this._state
    }

    getPeers(): IterableIterator<Peer> {
        return this._peers.values()
    }

    getPeerIds(): string[] {
        return [...this._peers.keys()]
    }

    addPeer(peer: Peer): void {
        const existing = this._peers.get(peer.id)
        if (existing) {
            existing.disconnect(CloseCode.Normal, CloseReason.ReplacedByReconnection)
        }

        this._peers.set(peer.id, peer)

        const otherIds = this.getPeerIds().filter((id) => id !== peer.id)
        peer.send({
            type: MessageType.RoomJoined,
            roomId: this.id,
            peerId: peer.id,
            peers: otherIds,
        })

        if (!existing) {
            this.broadcastExcept(peer.id, { type: MessageType.PeerJoined, peerId: peer.id })
        }

        peer.once(PeerEvent.Disconnected, () => {
            if (this._peers.get(peer.id) === peer) {
                this.removePeer(peer.id)
            }
        })

        this.emit(RoomEvent.PeerJoined, peer)
    }

    relay(fromId: string, toId: string, data: unknown): void {
        this._peers.get(toId)?.send({ type: MessageType.Signal, from: fromId, data })
    }

    private broadcastExcept(excludeId: string, msg: ServerMessage): void {
        for (const [id, peer] of this._peers) {
            if (id !== excludeId) peer.send(msg)
        }
    }

    private removePeer(peerId: string): void {
        const peer = this._peers.get(peerId)
        if (!peer) return
        this._peers.delete(peerId)
        this.broadcastExcept(peerId, { type: MessageType.PeerLeft, peerId })
        this.emit(RoomEvent.PeerLeft, peer)

        if (this._peers.size === 0) {
            this._state = RoomState.Closed
            this.emit(RoomEvent.Closed)
        }
    }
}
