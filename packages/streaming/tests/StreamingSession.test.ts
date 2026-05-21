import { EventEmitter } from 'node:events'
import { PeerRole, RoomEvent } from '@rtcforge/signaling'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingService } from '../src/StreamingService.js'
import { StreamingSession } from '../src/StreamingSession.js'
import { StreamingSessionEvent } from '../src/types.js'

// ── Fakes ─────────────────────────────────────────────────────────────────────

class MockPeer {
    readonly id: string
    readonly role: (typeof PeerRole)[keyof typeof PeerRole]
    constructor(id: string, role: (typeof PeerRole)[keyof typeof PeerRole] = PeerRole.Participant) {
        this.id = id
        this.role = role
    }
}

class MockRoom extends EventEmitter {
    private readonly _peers = new Map<string, MockPeer>()
    kickPeer = vi.fn((peerId: string) => {
        const peer = this._peers.get(peerId)
        if (peer) this.removePeer(peer)
    })

    addPeer(peer: MockPeer): void {
        this._peers.set(peer.id, peer)
        this.emit(RoomEvent.PeerJoined, peer)
    }

    removePeer(peer: MockPeer): void {
        this._peers.delete(peer.id)
        this.emit(RoomEvent.PeerLeft, peer)
    }

    getPeer(id: string): MockPeer | undefined {
        return this._peers.get(id)
    }

    closeRoom(): void {
        this.emit(RoomEvent.Closed)
    }
}

function makeHost(id = 'host-1'): MockPeer {
    return new MockPeer(id, PeerRole.Host)
}

function makeViewer(id: string): MockPeer {
    return new MockPeer(id, PeerRole.Viewer)
}

function makeParticipant(id: string): MockPeer {
    return new MockPeer(id, PeerRole.Participant)
}

// ── StreamingSession — lifecycle ──────────────────────────────────────────────

describe('StreamingSession — lifecycle', () => {
    let room: MockRoom

    beforeEach(() => {
        room = new MockRoom()
    })

    it('viewerCount starts at zero', () => {
        const session = new StreamingSession(room as never, { hostPeerId: 'host-1' })
        expect(session.viewerCount).toBe(0)
    })

    it('hostPeerId getter returns configured host', () => {
        const session = new StreamingSession(room as never, { hostPeerId: 'host-42' })
        expect(session.hostPeerId).toBe('host-42')
    })
})

// ── StreamingSession — viewer tracking ───────────────────────────────────────

describe('StreamingSession — viewer tracking', () => {
    let room: MockRoom
    let session: StreamingSession

    beforeEach(() => {
        room = new MockRoom()
        session = new StreamingSession(room as never, { hostPeerId: 'host-1' })
    })

    it('emits viewerJoined when a Viewer peer joins', () => {
        const listener = vi.fn()
        session.on(StreamingSessionEvent.ViewerJoined, listener)

        room.addPeer(makeViewer('v1'))

        expect(listener).toHaveBeenCalledWith('v1')
    })

    it('emits viewerCount when a Viewer peer joins', () => {
        const listener = vi.fn()
        session.on(StreamingSessionEvent.ViewerCount, listener)

        room.addPeer(makeViewer('v1'))

        expect(listener).toHaveBeenCalledWith(1)
    })

    it('viewerCount reflects current viewer set', () => {
        room.addPeer(makeViewer('v1'))
        room.addPeer(makeViewer('v2'))

        expect(session.viewerCount).toBe(2)
    })

    it('ignores non-Viewer peers joining (Participant)', () => {
        const joined = vi.fn()
        session.on(StreamingSessionEvent.ViewerJoined, joined)

        room.addPeer(makeParticipant('p1'))

        expect(joined).not.toHaveBeenCalled()
        expect(session.viewerCount).toBe(0)
    })

    it('ignores Host peer joining', () => {
        const joined = vi.fn()
        session.on(StreamingSessionEvent.ViewerJoined, joined)

        room.addPeer(makeHost('host-1'))

        expect(joined).not.toHaveBeenCalled()
        expect(session.viewerCount).toBe(0)
    })

    it('emits viewerLeft when a tracked viewer leaves', () => {
        const listener = vi.fn()
        const v1 = makeViewer('v1')
        room.addPeer(v1)
        session.on(StreamingSessionEvent.ViewerLeft, listener)

        room.removePeer(v1)

        expect(listener).toHaveBeenCalledWith('v1')
    })

    it('emits viewerCount with updated count when viewer leaves', () => {
        const v1 = makeViewer('v1')
        const v2 = makeViewer('v2')
        room.addPeer(v1)
        room.addPeer(v2)

        const counts: number[] = []
        session.on(StreamingSessionEvent.ViewerCount, (c) => counts.push(c))

        room.removePeer(v1)

        expect(counts).toContain(1)
        expect(session.viewerCount).toBe(1)
    })

    it('ignores peer leaving that was never a viewer', () => {
        const left = vi.fn()
        session.on(StreamingSessionEvent.ViewerLeft, left)

        room.addPeer(makeParticipant('p1'))
        room.removePeer(makeParticipant('p1'))

        expect(left).not.toHaveBeenCalled()
    })

    it('viewerCount is accurate after multiple joins and leaves', () => {
        const v1 = makeViewer('v1')
        const v2 = makeViewer('v2')
        const v3 = makeViewer('v3')
        room.addPeer(v1)
        room.addPeer(v2)
        room.addPeer(v3)
        room.removePeer(v2)

        expect(session.viewerCount).toBe(2)
    })
})

// ── StreamingSession — maxViewers ─────────────────────────────────────────────

describe('StreamingSession — maxViewers', () => {
    let room: MockRoom

    beforeEach(() => {
        room = new MockRoom()
    })

    it('accepts viewers up to the limit', () => {
        const session = new StreamingSession(room as never, {
            hostPeerId: 'host-1',
            maxViewers: 2,
        })
        room.addPeer(makeViewer('v1'))
        room.addPeer(makeViewer('v2'))

        expect(session.viewerCount).toBe(2)
    })

    it('kicks the viewer when limit is exceeded', () => {
        const session = new StreamingSession(room as never, { hostPeerId: 'host-1', maxViewers: 1 })
        session.on(StreamingSessionEvent.Error, () => {})
        room.addPeer(makeViewer('v1'))

        room.addPeer(makeViewer('v2'))

        expect(room.kickPeer).toHaveBeenCalledWith('v2')
    })

    it('does not track the kicked viewer', () => {
        const session = new StreamingSession(room as never, {
            hostPeerId: 'host-1',
            maxViewers: 1,
        })
        session.on(StreamingSessionEvent.Error, () => {})
        room.addPeer(makeViewer('v1'))
        room.addPeer(makeViewer('v2'))

        expect(session.viewerCount).toBe(1)
    })

    it('emits error when viewer limit is exceeded', () => {
        const session = new StreamingSession(room as never, {
            hostPeerId: 'host-1',
            maxViewers: 1,
        })
        const errorListener = vi.fn()
        session.on(StreamingSessionEvent.Error, errorListener)
        room.addPeer(makeViewer('v1'))

        room.addPeer(makeViewer('v2'))

        expect(errorListener).toHaveBeenCalledWith(expect.any(Error))
        expect(errorListener.mock.calls[0][0].message).toMatch('1')
    })

    it('does not emit viewerJoined for the kicked viewer', () => {
        const session = new StreamingSession(room as never, {
            hostPeerId: 'host-1',
            maxViewers: 1,
        })
        session.on(StreamingSessionEvent.Error, () => {})
        const joined = vi.fn()
        session.on(StreamingSessionEvent.ViewerJoined, joined)
        room.addPeer(makeViewer('v1'))
        vi.clearAllMocks()

        room.addPeer(makeViewer('v2'))

        expect(joined).not.toHaveBeenCalled()
    })
})

// ── StreamingSession — host disconnect ────────────────────────────────────────

describe('StreamingSession — host disconnect', () => {
    let room: MockRoom

    beforeEach(() => {
        room = new MockRoom()
    })

    it('kicks all viewers when host leaves', async () => {
        const host = makeHost('host-1')
        new StreamingSession(room as never, { hostPeerId: 'host-1' })
        room.addPeer(makeViewer('v1'))
        room.addPeer(makeViewer('v2'))

        room.removePeer(host)
        await Promise.resolve()

        expect(room.kickPeer).toHaveBeenCalledWith('v1')
        expect(room.kickPeer).toHaveBeenCalledWith('v2')
    })

    it('viewerCount is 0 after host disconnects', async () => {
        const host = makeHost('host-1')
        const session = new StreamingSession(room as never, { hostPeerId: 'host-1' })
        room.addPeer(makeViewer('v1'))

        room.removePeer(host)
        await Promise.resolve()

        expect(session.viewerCount).toBe(0)
    })

    it('stops listening to room events after host disconnect', async () => {
        const host = makeHost('host-1')
        const session = new StreamingSession(room as never, { hostPeerId: 'host-1' })
        const joined = vi.fn()
        session.on(StreamingSessionEvent.ViewerJoined, joined)

        room.removePeer(host)
        await Promise.resolve()

        room.addPeer(makeViewer('v-late'))
        expect(joined).not.toHaveBeenCalled()
    })
})

// ── StreamingSession — stop() ─────────────────────────────────────────────────

describe('StreamingSession — stop()', () => {
    let room: MockRoom
    let session: StreamingSession

    beforeEach(() => {
        room = new MockRoom()
        session = new StreamingSession(room as never, { hostPeerId: 'host-1' })
    })

    it('stop() kicks all active viewers', async () => {
        room.addPeer(makeViewer('v1'))
        room.addPeer(makeViewer('v2'))

        await session.stop()

        expect(room.kickPeer).toHaveBeenCalledWith('v1')
        expect(room.kickPeer).toHaveBeenCalledWith('v2')
    })

    it('stop() removes room listeners — new joins do not trigger events', async () => {
        const joined = vi.fn()
        session.on(StreamingSessionEvent.ViewerJoined, joined)

        await session.stop()
        room.addPeer(makeViewer('v1'))

        expect(joined).not.toHaveBeenCalled()
    })

    it('stop() is idempotent — second call is a no-op', async () => {
        room.addPeer(makeViewer('v1'))
        await session.stop()
        vi.clearAllMocks()

        await session.stop()

        expect(room.kickPeer).not.toHaveBeenCalled()
    })

    it('viewerCount is 0 after stop()', async () => {
        room.addPeer(makeViewer('v1'))
        await session.stop()
        expect(session.viewerCount).toBe(0)
    })
})

// ── StreamingService ──────────────────────────────────────────────────────────

describe('StreamingService', () => {
    let room: MockRoom

    beforeEach(() => {
        room = new MockRoom()
    })

    it('startSession() returns a StreamingSession', async () => {
        const host = makeHost('host-1')
        room.addPeer(host)
        const svc = new StreamingService()

        const session = await svc.startSession(room as never, { hostPeerId: 'host-1' })

        expect(session).toBeInstanceOf(StreamingSession)
    })

    it('startSession() throws when host peer not in room', () => {
        const svc = new StreamingService()

        expect(() => svc.startSession(room as never, { hostPeerId: 'ghost' })).toThrow('ghost')
    })

    it('sessionCount increments with each startSession', async () => {
        const h1 = makeHost('h1')
        const h2 = makeHost('h2')
        room.addPeer(h1)
        room.addPeer(h2)
        const svc = new StreamingService()

        await svc.startSession(room as never, { hostPeerId: 'h1' })
        await svc.startSession(room as never, { hostPeerId: 'h2' })

        expect(svc.sessionCount).toBe(2)
    })

    it('sessionCount decrements when room closes', async () => {
        room.addPeer(makeHost('host-1'))
        const svc = new StreamingService()
        await svc.startSession(room as never, { hostPeerId: 'host-1' })

        room.closeRoom()

        expect(svc.sessionCount).toBe(0)
    })

    it('stopAll() stops all active sessions', async () => {
        room.addPeer(makeHost('h1'))
        room.addPeer(makeHost('h2'))
        const svc = new StreamingService()
        const s1 = await svc.startSession(room as never, { hostPeerId: 'h1' })
        const s2 = await svc.startSession(room as never, { hostPeerId: 'h2' })
        room.addPeer(makeViewer('v1'))

        await svc.stopAll()

        expect(s1.viewerCount).toBe(0)
        expect(s2.viewerCount).toBe(0)
    })

    it('propagates service logger to session when no per-session logger given', async () => {
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        room.addPeer(makeHost('host-1'))
        const svc = new StreamingService({ logger })

        await svc.startSession(room as never, { hostPeerId: 'host-1' })

        expect(logger.info).toHaveBeenCalledWith('Streaming session started', expect.any(Object))
    })
})
