import { EventEmitter, toError } from 'rtcforge-core'
import type { Peer } from './Peer.js'
import { MessageType } from './protocol.js'
import type { ServerMessage } from './protocol.js'
import { CloseCode, CloseReason, PeerEvent, RoomEvent, RoomState } from './types.js'
import type { IceServerConfig } from './types.js'

type RoomEvents = {
    [RoomEvent.PeerJoined]: [peer: Peer]
    [RoomEvent.PeerLeft]: [peer: Peer]
    [RoomEvent.Closed]: []
    [RoomEvent.PeerError]: [peerId: string, err: Error]
    [RoomEvent.PeerKicked]: [peerId: string, reason: string | undefined]
}

const LEGAL_TRANSITIONS: Record<RoomState, readonly RoomState[]> = {
    [RoomState.Creating]: [RoomState.Active, RoomState.Closing, RoomState.Closed],
    [RoomState.Active]: [RoomState.Closing, RoomState.Closed],
    [RoomState.Closing]: [RoomState.Closed],
    [RoomState.Closed]: [],
}

/**
 * A group of peers that exchange signaling messages with one another.
 *
 * @remarks
 * A room is created lazily by {@link SignalingServer} when its first peer
 * joins and, unless kept alive, closes automatically when its last peer
 * leaves. It relays directed signals ({@link Room.relay}), fans out broadcasts
 * ({@link Room.broadcast} / {@link Room.broadcastExcept}), tracks per-peer
 * roles and metadata, and enforces optional capacity, idle-timeout, and
 * max-duration limits. Its lifecycle is modeled by {@link RoomState}.
 *
 * Rooms extend the core `EventEmitter` and emit {@link RoomEvent} values as
 * peers join, leave, error, or are kicked, and when the room closes. You
 * typically obtain a room from {@link SignalingServer.getRoom} or the
 * {@link ServerEvent.RoomCreated} event rather than constructing it directly.
 */
export class Room extends EventEmitter<RoomEvents> {
    /** Stable identifier of this room, taken from the joining peers' auth payloads. */
    readonly id: string
    private _state: RoomState = RoomState.Creating
    private readonly _peers = new Map<string, Peer>()
    private readonly maxPeers: number | undefined
    private readonly _peerMeta = new Map<string, Record<string, string>>()
    private readonly _idleTimeoutMs: number | undefined
    private _durationTimer: ReturnType<typeof setTimeout> | null = null
    private _idleTimer: ReturnType<typeof setTimeout> | null = null

    private readonly _keepAliveOnEmpty: boolean

    /**
     * Creates a room. Normally called by {@link SignalingServer}; construct
     * directly only in tests or custom hosts.
     *
     * @param id - The room's stable identifier.
     * @param opts - Optional limits.
     * @param opts.maxPeers - Maximum concurrent peers; further joins are rejected with {@link CloseReason.RoomFull}.
     * @param opts.maxDurationMs - Hard lifetime; the room force-closes after this many milliseconds regardless of activity.
     * @param opts.idleTimeoutMs - Idle window; the room force-closes if there is no relay/broadcast activity for this long while {@link RoomState.Active}.
     * @param opts.keepAliveOnEmpty - When `true`, the room stays open after the last peer leaves instead of closing. @defaultValue `false`
     */
    constructor(
        id: string,
        opts: {
            maxPeers?: number
            maxDurationMs?: number
            idleTimeoutMs?: number
            keepAliveOnEmpty?: boolean
        } = {},
    ) {
        super()
        this.id = id
        this.maxPeers = opts.maxPeers
        this._idleTimeoutMs = opts.idleTimeoutMs
        this._keepAliveOnEmpty = opts.keepAliveOnEmpty ?? false
        if (opts.maxDurationMs !== undefined) {
            this._durationTimer = setTimeout(() => this._forceClose(), opts.maxDurationMs)
        }
    }

    /**
     * The room's current lifecycle state. See {@link RoomState}.
     */
    get state(): RoomState {
        return this._state
    }

    private _transitionTo(next: RoomState): boolean {
        if (this._state === next) return false
        if (!LEGAL_TRANSITIONS[this._state].includes(next)) return false
        this._state = next
        return true
    }

    /**
     * @returns A snapshot array of all {@link Peer}s currently in the room.
     */
    getPeers(): Peer[] {
        return [...this._peers.values()]
    }

    /**
     * @returns The number of peers currently in the room.
     */
    getPeerCount(): number {
        return this._peers.size
    }

    /**
     * @returns A snapshot array of the ids of all peers in the room.
     */
    getPeerIds(): string[] {
        return [...this._peers.keys()]
    }

    /**
     * Looks up a peer by id.
     *
     * @param id - The peer id.
     * @returns The {@link Peer}, or `undefined` if not present.
     */
    getPeer(id: string): Peer | undefined {
        return this._peers.get(id)
    }

    /**
     * Adds a peer to the room and sends it the initial `room-joined` message.
     *
     * @remarks
     * If a peer with the same id is already present, the existing connection is
     * disconnected with {@link CloseReason.ReplacedByReconnection} and replaced
     * (reconnection semantics). If the room is at capacity, the incoming peer is
     * disconnected with {@link CloseReason.RoomFull} and `false` is returned.
     * On a genuinely new peer, the room notifies the others with `peer-joined`
     * and `presence-online`, transitions to {@link RoomState.Active}, and emits
     * {@link RoomEvent.PeerJoined}.
     *
     * @param peer - The peer to add.
     * @param iceServers - ICE servers to include in the peer's `room-joined`
     *   message, typically from {@link SignalingServerOptions.iceServersHook}.
     * @returns `true` if the peer was admitted; `false` if the room was full.
     * @throws If sending the initial `room-joined` message fails; the peer is
     *   rolled back out of the room before the error propagates.
     */
    addPeer(peer: Peer, iceServers?: IceServerConfig[]): boolean {
        const existing = this._peers.get(peer.id)

        if (!existing && this.maxPeers !== undefined && this._peers.size >= this.maxPeers) {
            peer.disconnect(CloseCode.PolicyViolation, CloseReason.RoomFull)
            return false
        }

        if (existing) {
            existing.disconnect(CloseCode.Normal, CloseReason.ReplacedByReconnection)
            this.emit(RoomEvent.PeerLeft, existing)
        }

        this._peers.set(peer.id, peer)
        if (peer.metadata && Object.keys(peer.metadata).length > 0) {
            this._peerMeta.set(peer.id, { ...peer.metadata })
        } else {
            this._peerMeta.delete(peer.id)
        }

        const otherIds: string[] = []
        const peerRoles: Record<string, string> = {}
        for (const [id, p] of this._peers) {
            if (id !== peer.id) {
                otherIds.push(id)
                if (p.role) peerRoles[id] = p.role
            }
        }

        try {
            peer.send({
                type: MessageType.RoomJoined,
                roomId: this.id,
                peerId: peer.id,
                peers: otherIds,
                peerRoles,
                peerMetadata: Object.fromEntries(this._peerMeta),
                ...(peer.role && { localRole: peer.role }),
                ...(iceServers && iceServers.length > 0 && { iceServers }),
            })
        } catch (err) {
            this._peers.delete(peer.id)
            this._peerMeta.delete(peer.id)
            throw err
        }

        if (!existing) {
            this.broadcastExcept(peer.id, {
                type: MessageType.PeerJoined,
                peerId: peer.id,
                role: peer.role,
                metadata: peer.metadata,
            })
            this.broadcastExcept(peer.id, { type: MessageType.PresenceOnline, peerId: peer.id })
        }

        peer.once(PeerEvent.Disconnected, () => {
            if (this._peers.get(peer.id) === peer) {
                this.removePeer(peer.id)
            }
        })

        this._transitionTo(RoomState.Active)
        this._resetIdleTimer()
        this.emit(RoomEvent.PeerJoined, peer)
        return true
    }

    /**
     * Forcibly removes a peer from the room.
     *
     * @remarks
     * Sends the peer a `kicked` message, disconnects it with
     * {@link CloseCode.PolicyViolation}, and emits {@link RoomEvent.PeerKicked}.
     *
     * @param peerId - Id of the peer to remove.
     * @param reason - Optional human-readable reason sent to the peer and used
     *   as the close reason; defaults to {@link CloseReason.Kicked}.
     * @returns `true` if the peer was found and kicked; `false` otherwise.
     */
    kickPeer(peerId: string, reason?: string): boolean {
        const peer = this._peers.get(peerId)
        if (!peer) return false
        try {
            peer.send({ type: MessageType.Kicked, peerId, reason })
        } catch {}
        peer.disconnect(CloseCode.PolicyViolation, reason ?? CloseReason.Kicked)
        this.emit(RoomEvent.PeerKicked, peerId, reason)
        return true
    }

    /**
     * Relays a directed signal from one peer to another and counts as room
     * activity (resets the idle timer).
     *
     * @param fromId - Id of the sending peer (stamped on the outgoing `signal`).
     * @param toId - Id of the recipient peer.
     * @param data - Opaque signal payload (SDP/ICE, etc.).
     * @returns `true` if the recipient existed and the message was sent; `false`
     *   if the recipient is absent or the send failed (which also emits
     *   {@link RoomEvent.PeerError}).
     */
    relay(fromId: string, toId: string, data: unknown): boolean {
        this._resetIdleTimer()
        const peer = this._peers.get(toId)
        if (!peer) return false
        try {
            peer.send({ type: MessageType.Signal, from: fromId, data })
            return true
        } catch (err) {
            this.emit(RoomEvent.PeerError, toId, toError(err))
            return false
        }
    }

    /**
     * Sends a message to every peer in the room.
     *
     * @param msg - The server message to fan out.
     * @returns Ids of peers whose send failed (each also emits
     *   {@link RoomEvent.PeerError}); empty when all sends succeeded.
     */
    broadcast(msg: ServerMessage): string[] {
        return this._sendToAll(msg)
    }

    /**
     * Sends a message to every peer except one.
     *
     * @param excludeId - Id of the peer to skip (usually the sender).
     * @param msg - The server message to fan out.
     * @returns Ids of peers whose send failed; empty when all sends succeeded.
     */
    broadcastExcept(excludeId: string, msg: ServerMessage): string[] {
        return this._sendToAll(msg, excludeId)
    }

    private _sendToAll(msg: ServerMessage, excludeId?: string): string[] {
        this._resetIdleTimer()
        const failed: string[] = []
        for (const [id, peer] of this._peers) {
            if (excludeId !== undefined && id === excludeId) continue
            try {
                peer.send(msg)
            } catch (err) {
                failed.push(id)
                this.emit(RoomEvent.PeerError, id, toError(err))
            }
        }
        return failed
    }

    private removePeer(peerId: string): void {
        const peer = this._peers.get(peerId)
        if (!peer) return
        this._peers.delete(peerId)
        this._peerMeta.delete(peerId)

        if (this._peers.size === 0 && !this._keepAliveOnEmpty) {
            this._clearTimers()
            this._transitionTo(RoomState.Closing)
            this.emit(RoomEvent.PeerLeft, peer)
            this._transitionTo(RoomState.Closed)
            this.emit(RoomEvent.Closed)
        } else {
            this.broadcastExcept(peerId, { type: MessageType.PeerLeft, peerId })
            this.broadcastExcept(peerId, { type: MessageType.PresenceOffline, peerId })
            this.emit(RoomEvent.PeerLeft, peer)
        }
    }

    /**
     * Marks the room as active, resetting the idle-timeout countdown.
     *
     * @remarks
     * Called on heartbeat pongs so that quiet-but-alive rooms are not closed by
     * {@link SignalingServerOptions.roomIdleTimeoutMs}.
     */
    markActivity(): void {
        this._resetIdleTimer()
    }

    /**
     * Returns a copy of the metadata a peer supplied at join time.
     *
     * @param peerId - The peer id.
     * @returns A shallow copy of the peer's metadata, or `undefined` if the peer
     *   is unknown or supplied none.
     */
    getPeerMetadata(peerId: string): Record<string, string> | undefined {
        const meta = this._peerMeta.get(peerId)
        return meta ? { ...meta } : undefined
    }

    /**
     * Changes a peer's role and notifies the whole room.
     *
     * @remarks
     * Updates the peer's role and broadcasts a `role-changed` message to every
     * peer (including the affected one).
     *
     * @param peerId - Id of the peer whose role is changing.
     * @param newRole - The new role string.
     * @returns `true` if the peer was found and updated; `false` otherwise.
     */
    setPeerRole(peerId: string, newRole: string): boolean {
        const peer = this._peers.get(peerId)
        if (!peer) return false
        peer.setRole(newRole)
        this.broadcast({ type: MessageType.RoleChanged, peerId, role: newRole })
        return true
    }

    /**
     * Tears down the room's timers and moves it to {@link RoomState.Closed}
     * without notifying or disconnecting peers. Used during server shutdown,
     * where connections are closed separately.
     */
    dispose(): void {
        this._clearTimers()
        this._transitionTo(RoomState.Closed)
    }

    private _clearTimers(): void {
        if (this._durationTimer) {
            clearTimeout(this._durationTimer)
            this._durationTimer = null
        }
        if (this._idleTimer) {
            clearTimeout(this._idleTimer)
            this._idleTimer = null
        }
    }

    private _resetIdleTimer(): void {
        if (this._idleTimeoutMs === undefined || this._state !== RoomState.Active) return
        if (this._idleTimer) clearTimeout(this._idleTimer)
        this._idleTimer = setTimeout(() => this._forceClose(), this._idleTimeoutMs)
    }

    private _forceClose(): void {
        if (this._state !== RoomState.Active && this._state !== RoomState.Creating) return
        this._transitionTo(RoomState.Closing)
        this._clearTimers()
        this.broadcast({ type: MessageType.Error, code: 'ROOM_EXPIRED', message: 'Room expired' })
        const peers = [...this._peers.values()]
        this._peers.clear()
        this._peerMeta.clear()
        for (const peer of peers) {
            peer.disconnect(CloseCode.Normal, 'Room expired')
            this.emit(RoomEvent.PeerLeft, peer)
        }
        this._transitionTo(RoomState.Closed)
        this.emit(RoomEvent.Closed)
    }
}
