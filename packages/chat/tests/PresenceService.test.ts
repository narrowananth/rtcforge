import { EventEmitter } from 'node:events'
import { RoomEvent } from '@rtcforge/signaling'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PresenceService } from '../src/PresenceService.js'
import { PresenceEvent } from '../src/types.js'

class MockPeer {
    readonly id: string
    constructor(id: string) {
        this.id = id
    }
}

class MockRoom extends EventEmitter {
    private readonly peers = new Map<string, MockPeer>()

    addPeer(peer: MockPeer): void {
        this.peers.set(peer.id, peer)
        this.emit(RoomEvent.PeerJoined, peer)
    }

    removePeer(peer: MockPeer): void {
        this.peers.delete(peer.id)
        this.emit(RoomEvent.PeerLeft, peer)
    }

    getPeers(): IterableIterator<MockPeer> {
        return this.peers.values()
    }
}

describe('PresenceService', () => {
    let room: MockRoom
    let presence: PresenceService

    beforeEach(() => {
        room = new MockRoom()
        presence = new PresenceService(room as never)
    })

    it('emits online when a peer joins', () => {
        const peer = new MockPeer('p1')
        const listener = vi.fn()
        presence.on(PresenceEvent.Online, listener)

        room.addPeer(peer)

        expect(listener).toHaveBeenCalledWith(peer)
    })

    it('emits offline when a peer leaves', () => {
        const peer = new MockPeer('p1')
        room.addPeer(peer)
        const listener = vi.fn()
        presence.on(PresenceEvent.Offline, listener)

        room.removePeer(peer)

        expect(listener).toHaveBeenCalledWith(peer)
    })

    it('getOnline returns currently connected peers', () => {
        const p1 = new MockPeer('p1')
        const p2 = new MockPeer('p2')
        room.addPeer(p1)
        room.addPeer(p2)

        const online = presence.getOnline()

        expect(online).toContain(p1)
        expect(online).toContain(p2)
        expect(online).toHaveLength(2)
    })

    it('getOnline reflects peers after one leaves', () => {
        const p1 = new MockPeer('p1')
        const p2 = new MockPeer('p2')
        room.addPeer(p1)
        room.addPeer(p2)
        room.removePeer(p1)

        const online = presence.getOnline()

        expect(online).not.toContain(p1)
        expect(online).toContain(p2)
    })

    it('emits online for each peer that joins independently', () => {
        const listener = vi.fn()
        presence.on(PresenceEvent.Online, listener)

        room.addPeer(new MockPeer('p1'))
        room.addPeer(new MockPeer('p2'))

        expect(listener).toHaveBeenCalledTimes(2)
    })

    it('calls onLastSeen with peerId and timestamp when a peer leaves', () => {
        const onLastSeen = vi.fn()
        const presence2 = new PresenceService(room as never, { onLastSeen })
        const peer = new MockPeer('p1')
        room.addPeer(peer)

        const before = Date.now()
        room.removePeer(peer)
        const after = Date.now()

        expect(onLastSeen).toHaveBeenCalledWith('p1', expect.any(Number))
        const ts = onLastSeen.mock.calls[0][1] as number
        expect(ts).toBeGreaterThanOrEqual(before)
        expect(ts).toBeLessThanOrEqual(after)
    })

    it('does not call onLastSeen when no hook is configured', () => {
        const peer = new MockPeer('p1')
        room.addPeer(peer)

        expect(() => room.removePeer(peer)).not.toThrow()
    })
})
