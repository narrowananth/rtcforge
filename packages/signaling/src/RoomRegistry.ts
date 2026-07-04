import { EventEmitter } from 'rtcforge-core'
import { Room } from './Room.js'
import { CloseCode, RoomEvent } from './types.js'

export const RoomRegistryEvent = {
    RoomClosed: 'roomClosed',
    PeerKicked: 'peerKicked',
} as const

type RoomRegistryEvents = {
    [RoomRegistryEvent.RoomClosed]: [roomId: string]
    [RoomRegistryEvent.PeerKicked]: [roomId: string, peerId: string, reason: string | undefined]
}

export interface RoomFactoryOptions {
    maxPeers?: number
    maxDurationMs?: number
    idleTimeoutMs?: number
}

export class RoomRegistry extends EventEmitter<RoomRegistryEvents> {
    private readonly _rooms = new Map<string, Room>()

    constructor(private readonly roomOpts: RoomFactoryOptions = {}) {
        super()
    }

    get size(): number {
        return this._rooms.size
    }

    get(roomId: string): Room | undefined {
        return this._rooms.get(roomId)
    }

    rooms(): Iterable<Room> {
        return [...this._rooms.values()]
    }

    totalPeers(): number {
        let count = 0
        for (const room of this._rooms.values()) count += room.getPeerCount()
        return count
    }

    getOrCreate(roomId: string): { room: Room; isNew: boolean } {
        const existing = this._rooms.get(roomId)
        if (existing) return { room: existing, isNew: false }

        const room = new Room(roomId, this.roomOpts)
        this._rooms.set(roomId, room)
        room.on(RoomEvent.Closed, () => {
            // Identity guard: a late Closed from an old room instance must not
            // evict a fresh room that reused the same id.
            if (this._rooms.get(roomId) === room) {
                this._rooms.delete(roomId)
            }
            this.emit(RoomRegistryEvent.RoomClosed, roomId)
        })
        room.on(RoomEvent.PeerKicked, (peerId, reason) => {
            this.emit(RoomRegistryEvent.PeerKicked, roomId, peerId, reason)
        })
        return { room, isNew: true }
    }

    rollbackIfEmpty(roomId: string, wasNew: boolean): void {
        const room = this._rooms.get(roomId)
        if (wasNew && room && room.getPeerCount() === 0) {
            room.dispose()
            this._rooms.delete(roomId)
        }
    }

    disconnectAll(reason: string): void {
        for (const room of this._rooms.values()) {
            for (const peer of room.getPeers()) peer.disconnect(CloseCode.Normal, reason)
            room.dispose()
        }
        this._rooms.clear()
    }
}
