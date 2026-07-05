import type { Logger } from 'rtcforge-core'
import type { Room } from './Room.js'
import { CloseCode, CloseReason } from './types.js'

/**
 * Collaborators a {@link HeartbeatMonitor} needs to ping peers and evict stale ones.
 */
export interface HeartbeatMonitorDeps {
    /** Supplies the current set of rooms to sweep each tick. */
    rooms: () => Iterable<Room>
    /** Interval between heartbeat sweeps, in milliseconds. */
    pingIntervalMs: number
    /** Milliseconds without a pong after which a peer is considered dead. */
    pongTimeoutMs: number
    /** Logger for timeout/disconnect diagnostics. */
    logger: Logger
}

/**
 * Periodically pings peers and disconnects any that stop responding.
 *
 * @remarks
 * On {@link HeartbeatMonitor.start | start} it runs a timer every `pingIntervalMs`;
 * each tick, any peer not seen within `pongTimeoutMs` is logged and removed
 * synchronously (iterating a snapshot, so mutating the room mid-loop is safe).
 * The timer is `unref`'d so it never keeps the process alive. Call
 * {@link HeartbeatMonitor.stop | stop} to halt.
 */
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
                    // Remove synchronously (getPeers() is a snapshot, so mutating
                    // the room mid-loop is safe). Otherwise the peer lingers in the
                    // room until its ws close handshake completes and is re-pruned
                    // on every subsequent tick.
                    room.disconnectAndRemove(
                        peer.id,
                        CloseCode.GoingAway,
                        CloseReason.HeartbeatTimeout,
                    )
                } else {
                    peer.ping()
                }
            }
        }
    }
}
