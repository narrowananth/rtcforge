import type { types as MsTypes } from 'mediasoup'
import { EventEmitter, noopLogger } from 'rtcforge-core'
import type { Logger } from 'rtcforge-core'
import { MediaRouter, MediaRouterEvent } from './MediaRouter.js'
import { WorkerPool, WorkerPoolEvent } from './WorkerPool.js'
import { DEFAULT_MEDIA_CODECS, RoomLikeEvent } from './types.js'
import type {
    MediaServiceOptions,
    RoomLike,
    RoomMemberLike,
    WebRtcTransportConfig,
} from './types.js'

export const MediaServiceEvent = {
    Error: 'error',
    RouterCreated: 'routerCreated',
    WorkerDied: 'workerDied',
} as const

type MediaServiceEvents = {
    [MediaServiceEvent.Error]: [err: Error]
    [MediaServiceEvent.RouterCreated]: [router: MediaRouter]
    [MediaServiceEvent.WorkerDied]: [pid: number]
}

export class MediaService extends EventEmitter<MediaServiceEvents> {
    private readonly _pool: WorkerPool
    private readonly _routers = new Map<string, MediaRouter>()
    private readonly _pending = new Map<string, Promise<MediaRouter>>()
    private readonly _detachers = new Map<string, () => void>()
    private readonly _logger: Logger
    private readonly _mediaCodecs: MsTypes.RouterRtpCodecCapability[]
    private readonly _webRtcConfig: WebRtcTransportConfig
    private _started = false

    constructor(options: MediaServiceOptions = {}) {
        super()
        this._logger = options.logger ?? noopLogger
        this._mediaCodecs = options.mediaCodecs ?? [...DEFAULT_MEDIA_CODECS]
        this._webRtcConfig = options.webRtcTransport ?? {}
        this._pool = new WorkerPool(options.worker, this._logger)
        this._pool.on(WorkerPoolEvent.Error, (err) => this.emit(MediaServiceEvent.Error, err))
        this._pool.on(WorkerPoolEvent.WorkerDied, (pid) => {
            this._logger.error('Worker died — routers on it are lost', { pid })
            this.emit(MediaServiceEvent.WorkerDied, pid)
        })
    }

    async init(): Promise<void> {
        await this._pool.start()
        this._started = true
    }

    get routerCount(): number {
        return this._routers.size
    }

    async attachRoom(room: RoomLike): Promise<MediaRouter> {
        if (!this._started) throw new Error('MediaService not initialized — call init() first')
        const existing = this._routers.get(room.id)
        if (existing) return existing
        const inFlight = this._pending.get(room.id)
        if (inFlight) return inFlight

        const creation = this._createRouter(room)
        this._pending.set(room.id, creation)
        try {
            return await creation
        } finally {
            this._pending.delete(room.id)
        }
    }

    private async _createRouter(room: RoomLike): Promise<MediaRouter> {
        let closedDuringInit = false
        const earlyClose = () => {
            closedDuringInit = true
        }
        room.once(RoomLikeEvent.Closed, earlyClose)

        const msRouter = await this._pool.createRouter({ mediaCodecs: this._mediaCodecs })
        room.off(RoomLikeEvent.Closed, earlyClose)

        const router = new MediaRouter(room.id, msRouter, this._webRtcConfig, this._logger)
        if (closedDuringInit) {
            router.close()
            throw new Error(`Room ${room.id} closed during router creation`)
        }
        this._routers.set(room.id, router)

        // Reap the router if it closes for any reason — explicit close OR its
        // worker dying underneath it — so getRouter/attachRoom never hand back a
        // dead router whose transports all throw.
        router.once(MediaRouterEvent.Closed, () => {
            if (this._routers.get(room.id) === router) {
                this._detach(room.id)
                this._routers.delete(room.id)
            }
        })

        const onPeerLeft = (peer: RoomMemberLike) => router.closeTransportsForPeer(peer.id)
        const onRoomClosed = () => {
            this._detach(room.id)
            router.close()
            this._routers.delete(room.id)
        }
        room.on(RoomLikeEvent.PeerLeft, onPeerLeft)
        room.once(RoomLikeEvent.Closed, onRoomClosed)
        this._detachers.set(room.id, () => {
            room.off(RoomLikeEvent.PeerLeft, onPeerLeft)
            room.off(RoomLikeEvent.Closed, onRoomClosed)
        })

        this.emit(MediaServiceEvent.RouterCreated, router)
        this._logger.debug('Router attached', { roomId: room.id })
        return router
    }

    getRouter(roomId: string): MediaRouter | undefined {
        return this._routers.get(roomId)
    }

    async pipeProducerToRoom(
        producerId: string,
        fromRoomId: string,
        toRoomId: string,
    ): Promise<void> {
        const from = this._routers.get(fromRoomId)
        const to = this._routers.get(toRoomId)
        if (!from) throw new Error(`Source room router not found: ${fromRoomId}`)
        if (!to) throw new Error(`Destination room router not found: ${toRoomId}`)
        await from.pipeProducerTo(producerId, to)
    }

    async closeAll(): Promise<void> {
        for (const roomId of [...this._detachers.keys()]) this._detach(roomId)
        for (const router of this._routers.values()) router.close()
        this._routers.clear()
        await this._pool.close()
        this._started = false
    }

    private _detach(roomId: string): void {
        this._detachers.get(roomId)?.()
        this._detachers.delete(roomId)
    }
}
