import { EventEmitter } from 'node:events'
import { MessageType, PeerEvent, RoomEvent } from '@rtcforge/signaling'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WhiteboardService } from '../src/WhiteboardService.js'
import { WhiteboardServiceEvent } from '../src/types.js'
import type { WhiteboardEvent } from '../src/types.js'

// ── Fakes ─────────────────────────────────────────────────────────────────────

class MockPeer extends EventEmitter {
    readonly id: string
    send = vi.fn()

    constructor(id: string) {
        super()
        this.id = id
    }

    simulateWhiteboardEvent(eventType: string, data?: unknown): void {
        this.emit(PeerEvent.WhiteboardEvent, eventType, data)
    }
}

class MockRoom extends EventEmitter {
    private readonly _peers = new Map<string, MockPeer>()
    broadcast = vi.fn()
    broadcastExcept = vi.fn()

    addPeer(peer: MockPeer): void {
        this._peers.set(peer.id, peer)
        this.emit(RoomEvent.PeerJoined, peer)
    }

    removePeer(peer: MockPeer): void {
        this._peers.delete(peer.id)
        this.emit(RoomEvent.PeerLeft, peer)
    }

    getPeers(): IterableIterator<MockPeer> {
        return this._peers.values()
    }
}

// ── WhiteboardService — lifecycle ─────────────────────────────────────────────

describe('WhiteboardService — lifecycle', () => {
    let room: MockRoom

    beforeEach(() => {
        room = new MockRoom()
    })

    it('wires peers that are already in the room at construction', () => {
        const p1 = new MockPeer('p1')
        room.addPeer(p1)
        vi.clearAllMocks()

        new WhiteboardService(room as never)

        p1.simulateWhiteboardEvent('draw', { x: 1 })
        expect(room.broadcastExcept).toHaveBeenCalledOnce()
    })

    it('wires peers that join after construction', () => {
        new WhiteboardService(room as never)
        const p1 = new MockPeer('p1')
        room.addPeer(p1)

        p1.simulateWhiteboardEvent('draw')
        expect(room.broadcastExcept).toHaveBeenCalledOnce()
    })

    it('stop() prevents new peers from being wired', () => {
        const svc = new WhiteboardService(room as never)
        svc.stop()

        const p1 = new MockPeer('p1')
        room.addPeer(p1)
        p1.simulateWhiteboardEvent('draw')

        expect(room.broadcastExcept).not.toHaveBeenCalled()
    })
})

// ── WhiteboardService — peer event broadcast ──────────────────────────────────

describe('WhiteboardService — peer event broadcast', () => {
    let room: MockRoom
    let p1: MockPeer

    beforeEach(() => {
        room = new MockRoom()
        new WhiteboardService(room as never)
        p1 = new MockPeer('p1')
        room.addPeer(p1)
    })

    it('calls broadcastExcept with the sender peer id', () => {
        p1.simulateWhiteboardEvent('draw', { x: 5 })

        expect(room.broadcastExcept).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({ type: MessageType.WhiteboardEvent, from: 'p1' }),
        )
    })

    it('broadcast message contains eventType and data', () => {
        p1.simulateWhiteboardEvent('draw', { x: 5, y: 10 })

        const [, msg] = room.broadcastExcept.mock.calls[0]
        expect(msg).toMatchObject({ eventType: 'draw', data: { x: 5, y: 10 } })
    })

    it('broadcast message has seq and ts fields', () => {
        p1.simulateWhiteboardEvent('move')

        const [, msg] = room.broadcastExcept.mock.calls[0]
        expect(typeof msg.seq).toBe('number')
        expect(typeof msg.ts).toBe('number')
    })

    it('seq increments across events', () => {
        p1.simulateWhiteboardEvent('draw')
        p1.simulateWhiteboardEvent('erase')

        const seq1 = room.broadcastExcept.mock.calls[0][1].seq
        const seq2 = room.broadcastExcept.mock.calls[1][1].seq
        expect(seq2).toBeGreaterThan(seq1)
    })

    it('emits WhiteboardServiceEvent.Event on peer whiteboard event', () => {
        const svc = new WhiteboardService(room as never)
        const p2 = new MockPeer('p2')
        room.addPeer(p2)

        const listener = vi.fn()
        svc.on(WhiteboardServiceEvent.Event, listener)
        p2.simulateWhiteboardEvent('draw', { x: 1 })

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ from: 'p2', type: 'draw', data: { x: 1 } }),
        )
    })

    it('does not call broadcast (all-peers) for peer events — only broadcastExcept', () => {
        p1.simulateWhiteboardEvent('draw')
        expect(room.broadcast).not.toHaveBeenCalled()
    })
})

// ── WhiteboardService — state sync ────────────────────────────────────────────

describe('WhiteboardService — state sync', () => {
    let room: MockRoom

    beforeEach(() => {
        room = new MockRoom()
    })

    it('late joiner receives WhiteboardSync when state is set', () => {
        const svc = new WhiteboardService(room as never)
        svc.sync({ shapes: [] })

        const p1 = new MockPeer('p1')
        room.addPeer(p1)

        expect(p1.send).toHaveBeenCalledWith({
            type: MessageType.WhiteboardSync,
            state: { shapes: [] },
        })
    })

    it('late joiner does not receive WhiteboardSync when state is undefined', () => {
        new WhiteboardService(room as never)
        const p1 = new MockPeer('p1')
        room.addPeer(p1)

        expect(p1.send).not.toHaveBeenCalled()
    })

    it('sync() updates getState()', () => {
        const svc = new WhiteboardService(room as never)
        svc.sync({ shapes: [{ id: '1' }] })

        expect(svc.getState()).toEqual({ shapes: [{ id: '1' }] })
    })

    it('sync() overwrite replaces previous state', () => {
        const svc = new WhiteboardService(room as never)
        svc.sync({ version: 1 })
        svc.sync({ version: 2 })

        expect(svc.getState()).toEqual({ version: 2 })
    })

    it('existing peers at construction receive sync if state is pre-set via options', () => {
        const p1 = new MockPeer('p1')
        room.addPeer(p1)
        vi.clearAllMocks()

        const svc = new WhiteboardService(room as never)
        svc.sync({ ready: true })

        const p2 = new MockPeer('p2')
        room.addPeer(p2)

        expect(p2.send).toHaveBeenCalledWith(
            expect.objectContaining({ type: MessageType.WhiteboardSync }),
        )
    })
})

// ── WhiteboardService — server broadcast ─────────────────────────────────────

describe('WhiteboardService — server broadcast()', () => {
    let room: MockRoom
    let svc: WhiteboardService

    beforeEach(() => {
        room = new MockRoom()
        svc = new WhiteboardService(room as never)
    })

    it('calls room.broadcast with correct shape', () => {
        svc.broadcast({ type: 'clear' })

        expect(room.broadcast).toHaveBeenCalledWith(
            expect.objectContaining({
                type: MessageType.WhiteboardEvent,
                from: 'system',
                eventType: 'clear',
            }),
        )
    })

    it('uses from: system', () => {
        svc.broadcast({ type: 'reset', data: null })

        const [msg] = room.broadcast.mock.calls[0]
        expect(msg.from).toBe('system')
    })

    it('emits Event with from: system', () => {
        const listener = vi.fn()
        svc.on(WhiteboardServiceEvent.Event, listener)

        svc.broadcast({ type: 'clear' })

        expect(listener).toHaveBeenCalledWith(
            expect.objectContaining({ from: 'system', type: 'clear' }),
        )
    })

    it('seq increments across broadcast calls', () => {
        svc.broadcast({ type: 'a' })
        svc.broadcast({ type: 'b' })

        const seq1 = room.broadcast.mock.calls[0][0].seq
        const seq2 = room.broadcast.mock.calls[1][0].seq
        expect(seq2).toBeGreaterThan(seq1)
    })
})

// ── WhiteboardService — CRDT merge hook ──────────────────────────────────────

describe('WhiteboardService — merge hook', () => {
    let room: MockRoom

    beforeEach(() => {
        room = new MockRoom()
    })

    it('merge hook called on peer event with current state and event', () => {
        const merge = vi.fn((current: unknown, ev: WhiteboardEvent) => ({
            ...(current as object),
            last: ev.type,
        }))
        const svc = new WhiteboardService(room as never, { merge })
        svc.sync({ shapes: [] })

        const p1 = new MockPeer('p1')
        room.addPeer(p1)
        p1.simulateWhiteboardEvent('draw', { x: 1 })

        expect(merge).toHaveBeenCalledWith(
            { shapes: [] },
            expect.objectContaining({ type: 'draw' }),
        )
    })

    it('merge result becomes new state', () => {
        const merge = (_current: unknown, ev: WhiteboardEvent) => ({ last: ev.type })
        const svc = new WhiteboardService(room as never, { merge })

        const p1 = new MockPeer('p1')
        room.addPeer(p1)
        p1.simulateWhiteboardEvent('draw')

        expect(svc.getState()).toEqual({ last: 'draw' })
    })

    it('merge hook called on server broadcast()', () => {
        const merge = vi.fn(() => ({ merged: true }))
        const svc = new WhiteboardService(room as never, { merge })

        svc.broadcast({ type: 'clear' })

        expect(merge).toHaveBeenCalledWith(
            undefined,
            expect.objectContaining({ from: 'system', type: 'clear' }),
        )
        expect(svc.getState()).toEqual({ merged: true })
    })

    it('without merge hook, state not modified by peer events', () => {
        const svc = new WhiteboardService(room as never)
        svc.sync({ initial: true })

        const p1 = new MockPeer('p1')
        room.addPeer(p1)
        p1.simulateWhiteboardEvent('draw')

        expect(svc.getState()).toEqual({ initial: true })
    })
})

// ── WhiteboardService — deduplication ────────────────────────────────────────

describe('WhiteboardService — deduplication', () => {
    let room: MockRoom

    beforeEach(() => {
        room = new MockRoom()
    })

    it('same peer is not double-wired on repeated PeerJoined events', () => {
        new WhiteboardService(room as never)
        const p1 = new MockPeer('p1')
        room.addPeer(p1)
        room.emit(RoomEvent.PeerJoined, p1)

        p1.simulateWhiteboardEvent('draw')
        expect(room.broadcastExcept).toHaveBeenCalledOnce()
    })
})
