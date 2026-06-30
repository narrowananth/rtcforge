import type { Logger } from 'rtcforge-core'
import type { Room } from './Room.js'
import { CloseCode, CloseReason } from './types.js'

export interface HeartbeatMonitorDeps {
    rooms: () => Iterable<Room>
    pingIntervalMs: number
    pongTimeoutMs: number
    logger: Logger
}

export class HeartbeatMonitor {
    private _timer?: ReturnType<typeof setInterval>

    constructor(private readonly deps: HeartbeatMonitorDeps) {}

    start(): void {
        if (this._timer !== undefined) return
        this._timer = setInterval(() => this._tick(), this.deps.pingIntervalMs)
        this._timer.unref()
    }

    stop(): void {
        if (this._timer !== undefined) {
            clearInterval(this._timer)
            this._timer = undefined
        }
    }

    private _tick(): void {
        const deadline = Date.now() - this.deps.pongTimeoutMs
        for (const room of this.deps.rooms()) {
            for (const peer of room.getPeers()) {
                if (!peer.isAlive(deadline)) {
                    this.deps.logger.warn('Heartbeat timeout, disconnecting peer', {
                        peerId: peer.id,
                    })
                    peer.disconnect(CloseCode.GoingAway, CloseReason.HeartbeatTimeout)
                } else {
                    peer.ping()
                }
            }
        }
    }
}
