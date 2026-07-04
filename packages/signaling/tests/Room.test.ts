import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Peer } from '../src/Peer.js'
import { Room } from '../src/Room.js'
import { MessageType } from '../src/protocol.js'
import { PeerEvent, RoomEvent, RoomState } from '../src/types.js'

class MockWs extends EventEmitter {
    readyState = 1
    send = vi.fn()
    close = vi.fn()
}

function makePeer(id: string): { peer: Peer; ws: MockWs } {
    const ws = new MockWs()
    const peer = new Peer({ id, role: 'participant', ws: ws as never, onSignal: vi.fn() })
    return { peer, ws }
}

function simulateDisconnect(ws: MockWs, code = 1000, reason = ''): void {
    ws.emit('close', code, Buffer.from(reason))
}

describe('Room', () => {
    let room: Room

    beforeEach(() => {
        room = new Room('r1')
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('addPeer', () => {
        it('rejects a peer once the room is closing/closed (zombie-room race)', () => {
            // Regression (REVIEW.md HIGH #4): a peer admitted into a room that
            // closed while an async hook was awaited becomes an invisible zombie
            // whose later close can evict a fresh same-id room.
            const { peer: p1 } = makePeer('p1')
            room.addPeer(p1)
            p1.emit(PeerEvent.Disconnected, 1000, 'bye') // last peer leaves → room closes
            expect(room.state).toBe(RoomState.Closed)

            const { peer: late, ws } = makePeer('late')
            expect(room.addPeer(late)).toBe(false)
            expect(room.getPeerCount()).toBe(0)
            expect(ws.close).toHaveBeenCalled()
        })

        it('sends room-joined to the joining peer with no existing peers', () => {
            const { peer, ws } = makePeer('p1')
            room.addPeer(peer)
            expect(ws.send).toHaveBeenCalledWith(
                JSON.stringify({
                    type: MessageType.RoomJoined,
                    v: 1,
                    roomId: 'r1',
                    peerId: 'p1',
                    peers: [],
                    peerRoles: {},
                    peerMetadata: {},
                    localRole: 'participant',
                }),
            )
        })

        it('sends room-joined with existing peer IDs', () => {
            const { peer: p1 } = makePeer('p1')
            const { peer: p2, ws: ws2 } = makePeer('p2')
            room.addPeer(p1)
            room.addPeer(p2)
            expect(ws2.send).toHaveBeenCalledWith(
                JSON.stringify({
                    type: MessageType.RoomJoined,
                    v: 1,
                    roomId: 'r1',
                    peerId: 'p2',
                    peers: ['p1'],
                    peerRoles: { p1: 'participant' },
                    peerMetadata: {},
                    localRole: 'participant',
                }),
            )
        })

        it('broadcasts peer-joined to existing peers', () => {
            const { peer: p1, ws: ws1 } = makePeer('p1')
            const { peer: p2 } = makePeer('p2')
            room.addPeer(p1)
            ws1.send.mockClear()
            room.addPeer(p2)
            expect(ws1.send).toHaveBeenCalledWith(
                JSON.stringify({
                    type: MessageType.PeerJoined,
                    peerId: 'p2',
                    role: 'participant',
                    metadata: {},
                }),
            )
        })

        it('emits peerJoined event', () => {
            const { peer } = makePeer('p1')
            const listener = vi.fn()
            room.on(RoomEvent.PeerJoined, listener)
            room.addPeer(peer)
            expect(listener).toHaveBeenCalledWith(peer)
        })

        it('disconnects old peer when peer reconnects with same ID', () => {
            const { peer: p1old, ws: ws1old } = makePeer('p1')
            const { peer: p1new } = makePeer('p1')
            room.addPeer(p1old)
            room.addPeer(p1new)
            expect(ws1old.close).toHaveBeenCalledWith(1000, 'Replaced by reconnection')
        })

        it('removes peer from _peers when RoomJoined send fails', () => {
            const { peer: p1, ws: ws1 } = makePeer('p1')
            ws1.readyState = 3
            expect(() => room.addPeer(p1)).toThrow()
            expect(room.getPeerCount()).toBe(0)
        })

        it('does not broadcast peer-joined to others on reconnection', () => {
            const { peer: p2, ws: ws2 } = makePeer('p2')
            const { peer: p1old } = makePeer('p1')
            const { peer: p1new } = makePeer('p1')
            room.addPeer(p2)
            room.addPeer(p1old)
            ws2.send.mockClear()
            room.addPeer(p1new)
            expect(ws2.send).not.toHaveBeenCalledWith(
                JSON.stringify({ type: MessageType.PeerJoined, peerId: 'p1' }),
            )
        })
    })

    describe('relay', () => {
        it('sends signal to target peer', () => {
            const { peer: p1 } = makePeer('p1')
            const { peer: p2, ws: ws2 } = makePeer('p2')
            room.addPeer(p1)
            room.addPeer(p2)
            ws2.send.mockClear()
            room.relay('p1', 'p2', { sdp: 'v=0' })
            expect(ws2.send).toHaveBeenCalledWith(
                JSON.stringify({ type: MessageType.Signal, from: 'p1', data: { sdp: 'v=0' } }),
            )
        })

        it('ignores relay to unknown peer ID', () => {
            expect(() => room.relay('p1', 'unknown', {})).not.toThrow()
        })

        it('emits peerError when relay target socket is not open', () => {
            const { peer: p1 } = makePeer('p1')
            const { peer: p2, ws: ws2 } = makePeer('p2')
            room.addPeer(p1)
            room.addPeer(p2)
            ws2.readyState = 3
            const errorListener = vi.fn()
            room.on(RoomEvent.PeerError, errorListener)
            room.relay('p1', 'p2', { sdp: 'v=0' })
            expect(errorListener).toHaveBeenCalledWith('p2', expect.any(Error))
        })
    })

    describe('peer disconnect', () => {
        it('broadcasts peer-left to remaining peers on disconnect', () => {
            const { peer: p1, ws: ws1 } = makePeer('p1')
            const { peer: p2, ws: ws2 } = makePeer('p2')
            room.addPeer(p1)
            room.addPeer(p2)
            ws2.send.mockClear()
            simulateDisconnect(ws1)
            expect(ws2.send).toHaveBeenCalledWith(
                JSON.stringify({ type: MessageType.PeerLeft, peerId: 'p1' }),
            )
        })

        it('emits peerLeft event', () => {
            const { peer: p1, ws: ws1 } = makePeer('p1')
            room.addPeer(p1)
            const listener = vi.fn()
            room.on(RoomEvent.PeerLeft, listener)
            simulateDisconnect(ws1)
            expect(listener).toHaveBeenCalledWith(p1)
        })

        it('closes room when last peer leaves', () => {
            const { peer: p1, ws: ws1 } = makePeer('p1')
            room.addPeer(p1)
            const closedListener = vi.fn()
            room.on(RoomEvent.Closed, closedListener)
            simulateDisconnect(ws1)
            expect(closedListener).toHaveBeenCalled()
            expect(room.state).toBe(RoomState.Closed)
        })

        it('does not remove replacing peer when old peer closes after reconnection', () => {
            const { peer: p1old, ws: ws1old } = makePeer('p1')
            const { peer: p1new } = makePeer('p1')
            room.addPeer(p1old)
            room.addPeer(p1new)
            const peerLeftListener = vi.fn()
            room.on(RoomEvent.PeerLeft, peerLeftListener)
            simulateDisconnect(ws1old)
            expect(peerLeftListener).not.toHaveBeenCalled()
        })
    })

    describe('getPeers / getPeerIds', () => {
        it('returns all current peer IDs', () => {
            const { peer: p1 } = makePeer('p1')
            const { peer: p2 } = makePeer('p2')
            room.addPeer(p1)
            room.addPeer(p2)
            expect(room.getPeerIds()).toEqual(['p1', 'p2'])
        })

        it('returns iterator of peer instances', () => {
            const { peer: p1 } = makePeer('p1')
            room.addPeer(p1)
            const peers = [...room.getPeers()]
            expect(peers).toContain(p1)
        })
    })

    describe('presence broadcasting', () => {
        it('broadcasts presence-online to existing peers when a new peer joins', () => {
            const { peer: p1, ws: ws1 } = makePeer('p1')
            const { peer: p2 } = makePeer('p2')
            room.addPeer(p1)
            ws1.send.mockClear()
            room.addPeer(p2)
            expect(ws1.send).toHaveBeenCalledWith(
                JSON.stringify({ type: MessageType.PresenceOnline, peerId: 'p2' }),
            )
        })

        it('broadcasts presence-offline to remaining peers on disconnect', () => {
            const { peer: p1, ws: ws1 } = makePeer('p1')
            const { peer: p2, ws: ws2 } = makePeer('p2')
            room.addPeer(p1)
            room.addPeer(p2)
            ws2.send.mockClear()
            simulateDisconnect(ws1)
            expect(ws2.send).toHaveBeenCalledWith(
                JSON.stringify({ type: MessageType.PresenceOffline, peerId: 'p1' }),
            )
        })

        it('does not broadcast presence-online on reconnection', () => {
            const { peer: p2, ws: ws2 } = makePeer('p2')
            const { peer: p1old } = makePeer('p1')
            const { peer: p1new } = makePeer('p1')
            room.addPeer(p2)
            room.addPeer(p1old)
            ws2.send.mockClear()
            room.addPeer(p1new)
            expect(ws2.send).not.toHaveBeenCalledWith(
                JSON.stringify({ type: MessageType.PresenceOnline, peerId: 'p1' }),
            )
        })
    })

    describe('kickPeer', () => {
        it('sends kicked message and disconnects the peer', () => {
            const { peer: p1, ws: ws1 } = makePeer('p1')
            room.addPeer(p1)
            const result = room.kickPeer('p1', 'spam')
            expect(result).toBe(true)
            expect(ws1.send).toHaveBeenCalledWith(
                JSON.stringify({ type: MessageType.Kicked, peerId: 'p1', reason: 'spam' }),
            )
            expect(ws1.close).toHaveBeenCalledWith(1008, 'spam')
        })

        it('returns false when peer is not found', () => {
            expect(room.kickPeer('nonexistent')).toBe(false)
        })

        it('removes the kicked peer synchronously (frees its slot immediately)', () => {
            const { peer: p1 } = makePeer('p1')
            const { peer: p2 } = makePeer('p2')
            room.addPeer(p1)
            room.addPeer(p2)
            expect(room.getPeerCount()).toBe(2)
            room.kickPeer('p1')
            // No waiting for the async ws close — gone right away.
            expect(room.getPeerCount()).toBe(1)
            expect(room.getPeer('p1')).toBeUndefined()
        })

        it('still disconnects peer and emits peerKicked when Kicked send fails', () => {
            const { peer: p1, ws: ws1 } = makePeer('p1')
            room.addPeer(p1)
            ws1.readyState = 3
            const kicked = vi.fn()
            room.on(RoomEvent.PeerKicked, kicked)
            const result = room.kickPeer('p1', 'ban')
            expect(result).toBe(true)
            expect(ws1.close).toHaveBeenCalled()
            expect(kicked).toHaveBeenCalledWith('p1', 'ban')
        })
    })

    describe('dispose', () => {
        it('clears peers so a late socket close does not re-emit Closed', () => {
            const { peer: p1 } = makePeer('p1')
            room.addPeer(p1)
            const closed = vi.fn()
            room.on(RoomEvent.Closed, closed)

            room.dispose()
            expect(room.getPeerCount()).toBe(0)

            // A socket 'close' arriving after shutdown must not drive removePeer →
            // Closed again (which would inflate server metrics/audit).
            p1.emit(PeerEvent.Disconnected, 1000, 'server stopping')
            expect(closed).not.toHaveBeenCalled()
        })
    })

    describe('maxPeers', () => {
        it('rejects new peers when room is full', () => {
            const fullRoom = new Room('full', { maxPeers: 1 })
            const { peer: p1 } = makePeer('p1')
            const { peer: p2, ws: ws2 } = makePeer('p2')
            fullRoom.addPeer(p1)
            const added = fullRoom.addPeer(p2)
            expect(added).toBe(false)
            expect(ws2.close).toHaveBeenCalledWith(1008, 'Room is full')
        })

        it('allows reconnection even when room is at capacity', () => {
            const fullRoom = new Room('full', { maxPeers: 1 })
            const { peer: p1old } = makePeer('p1')
            const { peer: p1new } = makePeer('p1')
            fullRoom.addPeer(p1old)
            const added = fullRoom.addPeer(p1new)
            expect(added).toBe(true)
        })
    })

    describe('_forceClose via maxDurationMs', () => {
        it('emits peerLeft for all peers before closed when room expires', () => {
            vi.useFakeTimers()
            const expRoom = new Room('expire-room', { maxDurationMs: 1000 })
            const { peer: p1 } = makePeer('p1')
            const { peer: p2 } = makePeer('p2')
            expRoom.addPeer(p1)
            expRoom.addPeer(p2)

            const leftPeerIds: string[] = []
            const closedOrder: string[] = []
            expRoom.on(RoomEvent.PeerLeft, (peer) => {
                leftPeerIds.push(peer.id)
                closedOrder.push('peerLeft')
            })
            expRoom.on(RoomEvent.Closed, () => closedOrder.push('closed'))

            vi.advanceTimersByTime(1001)

            expect(leftPeerIds).toHaveLength(2)
            expect(leftPeerIds).toContain('p1')
            expect(leftPeerIds).toContain('p2')
            expect(closedOrder[closedOrder.length - 1]).toBe('closed')
            vi.useRealTimers()
        })
    })

    describe('relay()', () => {
        it('returns true on successful send', () => {
            const { peer: p1 } = makePeer('p1')
            const { peer: p2 } = makePeer('p2')
            room.addPeer(p1)
            room.addPeer(p2)
            expect(room.relay('p1', 'p2', { sdp: 'offer' })).toBe(true)
        })

        it('returns false when target peer not in room', () => {
            const { peer: p1 } = makePeer('p1')
            room.addPeer(p1)
            expect(room.relay('p1', 'ghost', { sdp: 'offer' })).toBe(false)
        })

        it('returns false and emits PeerError when send throws', () => {
            const { peer: p1 } = makePeer('p1')
            const { peer: p2, ws: ws2 } = makePeer('p2')
            room.addPeer(p1)
            room.addPeer(p2)
            ws2.send.mockImplementation(() => {
                throw new Error('socket closed')
            })
            const errHandler = vi.fn()
            room.on(RoomEvent.PeerError, errHandler)
            expect(room.relay('p1', 'p2', {})).toBe(false)
            expect(errHandler).toHaveBeenCalledWith('p2', expect.any(Error))
        })
    })

    describe('_resetIdleTimer — S1 guard', () => {
        it('does not fire the idle timeout after the room has closed', () => {
            vi.useFakeTimers()
            const idleRoom = new Room('idle-room', { idleTimeoutMs: 100 })
            const { peer: p1, ws: ws1 } = makePeer('p1')
            idleRoom.addPeer(p1)
            const closedFn = vi.fn()
            idleRoom.on(RoomEvent.Closed, closedFn)

            simulateDisconnect(ws1)
            expect(idleRoom.state).toBe(RoomState.Closed)
            expect(closedFn).toHaveBeenCalledTimes(1)

            vi.advanceTimersByTime(1000)
            expect(closedFn).toHaveBeenCalledTimes(1)
        })

        it('does not reschedule idle timer during _forceClose broadcast', () => {
            vi.useFakeTimers()

            const idleRoom = new Room('idle-room', {
                idleTimeoutMs: 500,
                maxDurationMs: 100,
            })
            const { peer: p1 } = makePeer('p1')
            idleRoom.addPeer(p1)

            idleRoom.broadcast({ type: MessageType.Ping })

            const closedFn = vi.fn()
            idleRoom.on(RoomEvent.Closed, closedFn)

            vi.advanceTimersByTime(101)

            expect(closedFn).toHaveBeenCalledOnce()

            vi.advanceTimersByTime(600)
            expect(closedFn).toHaveBeenCalledOnce()

            vi.useRealTimers()
        })
    })
})
