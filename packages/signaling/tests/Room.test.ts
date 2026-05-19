import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Peer } from '../src/Peer.js'
import { Room } from '../src/Room.js'
import { MessageType } from '../src/protocol.js'
import { RoomEvent, RoomState } from '../src/types.js'

class MockWs extends EventEmitter {
    readyState = 1
    send = vi.fn()
    close = vi.fn()
}

function makePeer(id: string): { peer: Peer; ws: MockWs } {
    const ws = new MockWs()
    const peer = new Peer(id, 'participant', ws as never, vi.fn())
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

    describe('addPeer', () => {
        it('sends room-joined to the joining peer with no existing peers', () => {
            const { peer, ws } = makePeer('p1')
            room.addPeer(peer)
            expect(ws.send).toHaveBeenCalledWith(
                JSON.stringify({
                    type: MessageType.RoomJoined,
                    roomId: 'r1',
                    peerId: 'p1',
                    peers: [],
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
                    roomId: 'r1',
                    peerId: 'p2',
                    peers: ['p1'],
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
                JSON.stringify({ type: MessageType.PeerJoined, peerId: 'p2' }),
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

    describe('enableMedia', () => {
        it('registers onPeerJoined handler', () => {
            const onJoined = vi.fn()
            room.enableMedia(onJoined)
            const { peer: p1 } = makePeer('p1')
            room.addPeer(p1)
            expect(onJoined).toHaveBeenCalledWith(p1)
        })

        it('registers onPeerLeft handler when provided', () => {
            const onJoined = vi.fn()
            const onLeft = vi.fn()
            room.enableMedia(onJoined, onLeft)
            const { peer: p1, ws: ws1 } = makePeer('p1')
            room.addPeer(p1)
            simulateDisconnect(ws1)
            expect(onLeft).toHaveBeenCalledWith(p1)
        })
    })
})
