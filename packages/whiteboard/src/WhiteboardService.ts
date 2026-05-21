import { EventEmitter } from 'node:events'
import type { Peer, Room } from '@rtcforge/signaling'
import { MessageType, PeerEvent, RoomEvent } from '@rtcforge/signaling'
import { WhiteboardServiceEvent, noopLogger } from './types.js'
import type { Logger, WhiteboardEvent, WhiteboardServiceOptions } from './types.js'

export declare interface WhiteboardService {
    on(event: typeof WhiteboardServiceEvent.Event, listener: (event: WhiteboardEvent) => void): this
    on(event: typeof WhiteboardServiceEvent.Error, listener: (err: Error) => void): this
    once(
        event: typeof WhiteboardServiceEvent.Event,
        listener: (event: WhiteboardEvent) => void,
    ): this
    once(event: typeof WhiteboardServiceEvent.Error, listener: (err: Error) => void): this
    emit(event: typeof WhiteboardServiceEvent.Event, wbEvent: WhiteboardEvent): boolean
    emit(event: typeof WhiteboardServiceEvent.Error, err: Error): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter overload pattern
export class WhiteboardService extends EventEmitter {
    private readonly _room: Room
    private readonly _logger: Logger
    private readonly _merge: ((current: unknown, incoming: WhiteboardEvent) => unknown) | undefined
    private readonly _wiredPeers = new Set<string>()
    private _state: unknown
    private _seq = 0
    private _stopped = false

    private readonly _onPeerJoined = (peer: Peer) => this._wirePeer(peer)
    private readonly _onPeerLeft = (peer: Peer) => this._wiredPeers.delete(peer.id)

    constructor(room: Room, options: WhiteboardServiceOptions = {}) {
        super()
        this._room = room
        this._logger = options.logger ?? noopLogger
        this._merge = options.merge

        for (const peer of room.getPeers()) {
            this._wirePeer(peer)
        }

        room.on(RoomEvent.PeerJoined, this._onPeerJoined)
        room.on(RoomEvent.PeerLeft, this._onPeerLeft)
    }

    sync(state: unknown): void {
        this._state = state
        this._logger.debug('Whiteboard state synced')
    }

    getState(): unknown {
        return this._state
    }

    broadcast(event: { type: string; data?: unknown }): void {
        const seq = ++this._seq
        const ts = Date.now()
        const wbEvent: WhiteboardEvent = {
            from: 'system',
            type: event.type,
            data: event.data,
            seq,
            ts,
        }
        this._room.broadcast({
            type: MessageType.WhiteboardEvent,
            from: 'system',
            eventType: event.type,
            data: event.data,
            seq,
            ts,
        })
        if (this._merge !== undefined) {
            this._state = this._merge(this._state, wbEvent)
        }
        this.emit(WhiteboardServiceEvent.Event, wbEvent)
        this._logger.debug('Whiteboard event broadcast', { from: 'system', type: event.type })
    }

    stop(): void {
        this._stopped = true
        this._room.off(RoomEvent.PeerJoined, this._onPeerJoined)
        this._room.off(RoomEvent.PeerLeft, this._onPeerLeft)
        this._wiredPeers.clear()
    }

    private _wirePeer(peer: Peer): void {
        if (this._wiredPeers.has(peer.id)) return
        this._wiredPeers.add(peer.id)

        if (this._state !== undefined) {
            peer.send({ type: MessageType.WhiteboardSync, state: this._state })
            this._logger.debug('Whiteboard state synced to peer', { peerId: peer.id })
        }

        peer.on(PeerEvent.WhiteboardEvent, (eventType: string, data: unknown) => {
            if (this._stopped) return
            const seq = ++this._seq
            const ts = Date.now()
            const wbEvent: WhiteboardEvent = { from: peer.id, type: eventType, data, seq, ts }
            this._room.broadcastExcept(peer.id, {
                type: MessageType.WhiteboardEvent,
                from: peer.id,
                eventType,
                data,
                seq,
                ts,
            })
            if (this._merge !== undefined) {
                this._state = this._merge(this._state, wbEvent)
            }
            this.emit(WhiteboardServiceEvent.Event, wbEvent)
            this._logger.debug('Whiteboard event broadcast', { from: peer.id, type: eventType })
        })
    }
}
