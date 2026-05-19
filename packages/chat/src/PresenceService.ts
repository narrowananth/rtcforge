import { EventEmitter } from 'node:events'
import type { Peer, Room } from '@rtcforge/signaling'
import { RoomEvent } from '@rtcforge/signaling'
import { PresenceEvent, noopLogger } from './types.js'
import type { Logger, PresenceServiceOptions } from './types.js'

export declare interface PresenceService {
    on(event: typeof PresenceEvent.Online, listener: (peer: Peer) => void): this
    on(event: typeof PresenceEvent.Offline, listener: (peer: Peer) => void): this
    once(event: typeof PresenceEvent.Online, listener: (peer: Peer) => void): this
    once(event: typeof PresenceEvent.Offline, listener: (peer: Peer) => void): this
    emit(event: typeof PresenceEvent.Online, peer: Peer): boolean
    emit(event: typeof PresenceEvent.Offline, peer: Peer): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter overload pattern
export class PresenceService extends EventEmitter {
    private readonly room: Room
    private readonly logger: Logger
    private readonly onLastSeen?: (peerId: string, ts: number) => void

    constructor(room: Room, opts: PresenceServiceOptions = {}) {
        super()
        this.room = room
        this.logger = opts.logger ?? noopLogger
        this.onLastSeen = opts.onLastSeen

        room.on(RoomEvent.PeerJoined, (peer) => {
            this.logger.debug('Peer came online', { peerId: peer.id })
            this.emit(PresenceEvent.Online, peer)
        })

        room.on(RoomEvent.PeerLeft, (peer) => {
            this.logger.debug('Peer went offline', { peerId: peer.id })
            this.onLastSeen?.(peer.id, Date.now())
            this.emit(PresenceEvent.Offline, peer)
        })
    }

    getOnline(): Peer[] {
        return [...this.room.getPeers()]
    }
}
