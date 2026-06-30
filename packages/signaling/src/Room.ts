import { EventEmitter, toError } from '@rtcforge/core'
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

export class Room extends EventEmitter<RoomEvents> {
    readonly id: string
    private _state: RoomState = RoomState.Creating
    private readonly _peers = new Map<string, Peer>()
    private readonly maxPeers: number | undefined
    private readonly _peerMeta = new Map<string, Record<string, string>>()
    private readonly _idleTimeoutMs: number | undefined
    private _durationTimer: ReturnType<typeof setTimeout> | null = null
    private _idleTimer: ReturnType<typeof setTimeout> | null = null

    private readonly _keepAliveOnEmpty: boolean

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

    get state(): RoomState {
        return this._state
    }

    private _transitionTo(next: RoomState): boolean {
        if (this._state === next) return false
        if (!LEGAL_TRANSITIONS[this._state].includes(next)) return false
        this._state = next
        return true
    }

    getPeers(): Peer[] {
        return [...this._peers.values()]
    }

    getPeerCount(): number {
        return this._peers.size
    }

    getPeerIds(): string[] {
        return [...this._peers.keys()]
    }

    getPeer(id: string): Peer | undefined {
        return this._peers.get(id)
    }

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

    broadcast(msg: ServerMessage): string[] {
        return this._sendToAll(msg)
    }

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

    markActivity(): void {
        this._resetIdleTimer()
    }

    getPeerMetadata(peerId: string): Record<string, string> | undefined {
        const meta = this._peerMeta.get(peerId)
        return meta ? { ...meta } : undefined
    }

    setPeerRole(peerId: string, newRole: string): boolean {
        const peer = this._peers.get(peerId)
        if (!peer) return false
        peer.setRole(newRole)
        this.broadcast({ type: MessageType.RoleChanged, peerId, role: newRole })
        return true
    }

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
