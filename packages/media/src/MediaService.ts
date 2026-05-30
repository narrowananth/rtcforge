import { EventEmitter, noopLogger } from '@rtcforge/core'
import type { Logger } from '@rtcforge/core'
import type { Peer, Room } from '@rtcforge/signaling'
import { RoomEvent } from '@rtcforge/signaling'
import { MediaRouter } from './MediaRouter.js'
import type { MediaServiceOptions } from './types.js'

export const MediaServiceEvent = {
    Error: 'error',
    RouterCreated: 'routerCreated',
} as const

type MediaServiceEvents = {
    [MediaServiceEvent.Error]: [err: Error]
    [MediaServiceEvent.RouterCreated]: [router: MediaRouter]
}

export class MediaService extends EventEmitter<MediaServiceEvents> {
    private readonly _routers = new Map<string, MediaRouter>()
    private readonly _cleanups = new Map<string, { onPeerLeft: () => void; onClosed: () => void }>()
    private readonly _logger: Logger

    constructor(options: MediaServiceOptions = {}) {
        super()
        this._logger = options.logger ?? noopLogger
    }

    get routerCount(): number {
        return this._routers.size
    }

    attachRoom(room: Room): MediaRouter {
        const existing = this._routers.get(room.id)
        if (existing) return existing

        const router = new MediaRouter(room.id)
        this._routers.set(room.id, router)

        const onPeerLeft = (peer: Peer) => {
            router.closeProducersForPeer(peer.id)
            router.closeConsumersForPeer(peer.id)
        }
        const onRoomClosed = () => {
            room.off(RoomEvent.PeerLeft, onPeerLeft)
            this._cleanups.delete(room.id)
            router.close()
            this._routers.delete(room.id)
        }
        room.on(RoomEvent.PeerLeft, onPeerLeft)
        room.once(RoomEvent.Closed, onRoomClosed)
        this._cleanups.set(room.id, {
            onPeerLeft: () => room.off(RoomEvent.PeerLeft, onPeerLeft),
            onClosed: () => room.off(RoomEvent.Closed, onRoomClosed),
        })

        this.emit(MediaServiceEvent.RouterCreated, router)
        this._logger.debug('Router attached', { roomId: room.id })
        return router
    }

    getRouter(roomId: string): MediaRouter | undefined {
        return this._routers.get(roomId)
    }

    closeAll(): void {
        for (const { onPeerLeft, onClosed } of this._cleanups.values()) {
            onPeerLeft()
            onClosed()
        }
        this._cleanups.clear()
        const count = this._routers.size
        for (const router of this._routers.values()) router.close()
        this._routers.clear()
        this._logger.debug('All routers closed', { count })
    }
}
