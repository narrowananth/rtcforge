import { EventEmitter } from 'node:events'
import type { Peer, Room } from '@rtcforge/signaling'
import { PeerRole, RoomEvent } from '@rtcforge/signaling'
import { StreamingSessionEvent, noopLogger } from './types.js'
import type { Logger, StreamingSessionOptions } from './types.js'

export declare interface StreamingSession {
    on(event: typeof StreamingSessionEvent.ViewerJoined, listener: (peerId: string) => void): this
    on(event: typeof StreamingSessionEvent.ViewerLeft, listener: (peerId: string) => void): this
    on(event: typeof StreamingSessionEvent.ViewerCount, listener: (count: number) => void): this
    on(event: typeof StreamingSessionEvent.Error, listener: (err: Error) => void): this
    once(event: typeof StreamingSessionEvent.ViewerJoined, listener: (peerId: string) => void): this
    once(event: typeof StreamingSessionEvent.ViewerLeft, listener: (peerId: string) => void): this
    once(event: typeof StreamingSessionEvent.ViewerCount, listener: (count: number) => void): this
    once(event: typeof StreamingSessionEvent.Error, listener: (err: Error) => void): this
    emit(event: typeof StreamingSessionEvent.ViewerJoined, peerId: string): boolean
    emit(event: typeof StreamingSessionEvent.ViewerLeft, peerId: string): boolean
    emit(event: typeof StreamingSessionEvent.ViewerCount, count: number): boolean
    emit(event: typeof StreamingSessionEvent.Error, err: Error): boolean
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: typed EventEmitter overload pattern
export class StreamingSession extends EventEmitter {
    private readonly _room: Room
    private readonly _hostPeerId: string
    private readonly _maxViewers: number | undefined
    private readonly _logger: Logger
    private readonly _viewers = new Set<string>()
    private _stopped = false

    private readonly _onPeerJoined: (peer: Peer) => void
    private readonly _onPeerLeft: (peer: Peer) => void

    constructor(room: Room, options: StreamingSessionOptions) {
        super()
        this._room = room
        this._hostPeerId = options.hostPeerId
        this._maxViewers = options.maxViewers
        this._logger = options.logger ?? noopLogger

        this._onPeerJoined = (peer: Peer) => {
            if (peer.role !== PeerRole.Viewer) return

            if (this._maxViewers !== undefined && this._viewers.size >= this._maxViewers) {
                this._logger.warn('Max viewers reached — kicking peer', { peerId: peer.id })
                room.kickPeer(peer.id)
                this.emit(
                    StreamingSessionEvent.Error,
                    new Error(`Viewer limit reached: ${this._maxViewers}`),
                )
                return
            }

            this._viewers.add(peer.id)
            this._logger.info('Viewer joined', { peerId: peer.id, count: this._viewers.size })
            this.emit(StreamingSessionEvent.ViewerJoined, peer.id)
            this.emit(StreamingSessionEvent.ViewerCount, this._viewers.size)
        }

        this._onPeerLeft = (peer: Peer) => {
            if (peer.id === this._hostPeerId) {
                this._logger.info('Host disconnected — stopping session', { peerId: peer.id })
                void this.stop()
                return
            }

            if (!this._viewers.has(peer.id)) return

            this._viewers.delete(peer.id)
            this._logger.info('Viewer left', { peerId: peer.id, count: this._viewers.size })
            this.emit(StreamingSessionEvent.ViewerLeft, peer.id)
            this.emit(StreamingSessionEvent.ViewerCount, this._viewers.size)
        }

        room.on(RoomEvent.PeerJoined, this._onPeerJoined)
        room.on(RoomEvent.PeerLeft, this._onPeerLeft)
        this._logger.info('Streaming session started', { hostPeerId: this._hostPeerId })
    }

    get viewerCount(): number {
        return this._viewers.size
    }

    get hostPeerId(): string {
        return this._hostPeerId
    }

    stop(): void {
        if (this._stopped) return
        this._stopped = true

        this._room.off(RoomEvent.PeerJoined, this._onPeerJoined)
        this._room.off(RoomEvent.PeerLeft, this._onPeerLeft)

        for (const peerId of this._viewers) {
            this._room.kickPeer(peerId)
        }
        this._viewers.clear()

        this._logger.info('Streaming session stopped', { hostPeerId: this._hostPeerId })
    }
}
