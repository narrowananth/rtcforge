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

    private readonly handlePeerJoined = (peer: Peer): void => {
        this.logger.debug('Peer came online', { peerId: peer.id })
        this.emit(PresenceEvent.Online, peer)
    }

    private readonly handlePeerLeft = (peer: Peer): void => {
        this.logger.debug('Peer went offline', { peerId: peer.id })
        this.onLastSeen?.(peer.id, Date.now())
        this.emit(PresenceEvent.Offline, peer)
    }

    constructor(room: Room, opts: PresenceServiceOptions = {}) {
        super()
        this.room = room
        this.logger = opts.logger ?? noopLogger
        this.onLastSeen = opts.onLastSeen

        room.on(RoomEvent.PeerJoined, this.handlePeerJoined)
        room.on(RoomEvent.PeerLeft, this.handlePeerLeft)
    }

    getOnline(): Peer[] {
        return [...this.room.getPeers()]
    }

    stop(): void {
        this.room.off(RoomEvent.PeerJoined, this.handlePeerJoined)
        this.room.off(RoomEvent.PeerLeft, this.handlePeerLeft)
        this.removeAllListeners()
    }
}
