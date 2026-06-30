import { describe, expect, it, vi } from 'vitest'
import { Room } from '../src/Room.js'
import type { RoomTransport } from '../src/Room.js'
import { MessageType } from '../src/protocol.js'
import { RoomEvent } from '../src/types.js'

function makeTransport(): RoomTransport {
    return { send: vi.fn() }
}

describe('Room', () => {
    it('initialises with local peer ID in peers list', () => {
        const { room } = Room.create({
            id: 'r1',
            localPeerId: 'local',
            peers: [],
            transport: makeTransport(),
        })
        expect(room.peers).toContain('local')
    })

    it('initialises with remote peers from constructor', () => {
        const { room } = Room.create({
            id: 'r1',
            localPeerId: 'local',
            peers: ['p2', 'p3'],
            transport: makeTransport(),
        })
        expect(room.peers).toContain('p2')
        expect(room.peers).toContain('p3')
    })

    describe('control.handleMessage', () => {
        it('adds peer and emits peer-joined on peer-joined message', () => {
            const { room, control } = Room.create({
                id: 'r1',
                localPeerId: 'local',
                peers: [],
                transport: makeTransport(),
            })
            const listener = vi.fn()
            room.on(MessageType.PeerJoined, listener)
            control.handleMessage({ type: MessageType.PeerJoined, peerId: 'p2' })
            expect(room.peers).toContain('p2')
            expect(listener).toHaveBeenCalledWith('p2')
        })

        it('removes peer and emits peer-left on peer-left message', () => {
            const { room, control } = Room.create({
                id: 'r1',
                localPeerId: 'local',
                peers: ['p2'],
                transport: makeTransport(),
            })
            const listener = vi.fn()
            room.on(MessageType.PeerLeft, listener)
            control.handleMessage({ type: MessageType.PeerLeft, peerId: 'p2' })
            expect(room.peers).not.toContain('p2')
            expect(listener).toHaveBeenCalledWith('p2')
        })

        it('emits signal event on signal message', () => {
            const { room, control } = Room.create({
                id: 'r1',
                localPeerId: 'local',
                peers: ['p2'],
                transport: makeTransport(),
            })
            const listener = vi.fn()
            room.on(MessageType.Signal, listener)
            control.handleMessage({
                type: MessageType.Signal,
                from: 'p2',
                data: { candidate: 'ice' },
            })
            expect(listener).toHaveBeenCalledWith('p2', { candidate: 'ice' })
        })

        it('ignores unknown message types silently', () => {
            const { control } = Room.create({
                id: 'r1',
                localPeerId: 'local',
                peers: [],
                transport: makeTransport(),
            })
            expect(() => {
                control.handleMessage({ type: MessageType.Ping } as never)
            }).not.toThrow()
        })
    })

    describe('control.refresh', () => {
        it('replaces peer set on reconnection', () => {
            const { room, control } = Room.create({
                id: 'r1',
                localPeerId: 'local',
                peers: ['stale-peer'],
                transport: makeTransport(),
            })
            control.refresh({ localPeerId: 'local', peers: ['new-p2'] })
            expect(room.peers).toContain('local')
            expect(room.peers).toContain('new-p2')
            expect(room.peers).not.toContain('stale-peer')
        })
    })

    describe('control.close', () => {
        it('emits closed event', () => {
            const { room, control } = Room.create({
                id: 'r1',
                localPeerId: 'local',
                peers: [],
                transport: makeTransport(),
            })
            const listener = vi.fn()
            room.on(RoomEvent.Closed, listener)
            control.close()
            expect(listener).toHaveBeenCalled()
        })
    })

    describe('sendSignal', () => {
        it('sends signal message via transport', () => {
            const transport = makeTransport()
            const { room } = Room.create({ id: 'r1', localPeerId: 'local', peers: [], transport })
            room.sendSignal('p2', { sdp: 'offer' })
            expect(transport.send).toHaveBeenCalledWith({
                type: MessageType.Signal,
                to: 'p2',
                data: { sdp: 'offer' },
            })
        })
    })
})
