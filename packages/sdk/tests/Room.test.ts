import { describe, expect, it, vi } from 'vitest'
import { Room } from '../src/Room.js'
import type { WebSocketTransport } from '../src/WebSocketTransport.js'
import { MessageType } from '../src/protocol.js'

function makeTransport(): WebSocketTransport {
    return { send: vi.fn() } as unknown as WebSocketTransport
}

describe('Room', () => {
    it('initialises with local peer ID in peers list', () => {
        const room = new Room('r1', 'local', [], makeTransport())
        expect(room.peers).toContain('local')
    })

    it('initialises with remote peers from constructor', () => {
        const room = new Room('r1', 'local', ['p2', 'p3'], makeTransport())
        expect(room.peers).toContain('p2')
        expect(room.peers).toContain('p3')
    })

    describe('_handleMessage', () => {
        it('adds peer and emits peer-joined on peer-joined message', () => {
            const room = new Room('r1', 'local', [], makeTransport())
            const listener = vi.fn()
            room.on(MessageType.PeerJoined, listener)
            room._handleMessage({ type: MessageType.PeerJoined, peerId: 'p2' })
            expect(room.peers).toContain('p2')
            expect(listener).toHaveBeenCalledWith('p2')
        })

        it('removes peer and emits peer-left on peer-left message', () => {
            const room = new Room('r1', 'local', ['p2'], makeTransport())
            const listener = vi.fn()
            room.on(MessageType.PeerLeft, listener)
            room._handleMessage({ type: MessageType.PeerLeft, peerId: 'p2' })
            expect(room.peers).not.toContain('p2')
            expect(listener).toHaveBeenCalledWith('p2')
        })

        it('emits signal event on signal message', () => {
            const room = new Room('r1', 'local', ['p2'], makeTransport())
            const listener = vi.fn()
            room.on(MessageType.Signal, listener)
            room._handleMessage({
                type: MessageType.Signal,
                from: 'p2',
                data: { candidate: 'ice' },
            })
            expect(listener).toHaveBeenCalledWith('p2', { candidate: 'ice' })
        })

        it('ignores unknown message types silently', () => {
            const room = new Room('r1', 'local', [], makeTransport())
            expect(() => {
                room._handleMessage({ type: MessageType.Ping } as never)
            }).not.toThrow()
        })
    })

    describe('_refresh', () => {
        it('replaces peer set on reconnection', () => {
            const room = new Room('r1', 'local', ['stale-peer'], makeTransport())
            room._refresh('local', ['new-p2'])
            expect(room.peers).toContain('local')
            expect(room.peers).toContain('new-p2')
            expect(room.peers).not.toContain('stale-peer')
        })
    })

    describe('_close', () => {
        it('emits closed event', () => {
            const room = new Room('r1', 'local', [], makeTransport())
            const listener = vi.fn()
            room.on('closed', listener)
            room._close()
            expect(listener).toHaveBeenCalled()
        })
    })

    describe('sendSignal', () => {
        it('sends signal message via transport', () => {
            const transport = makeTransport()
            const room = new Room('r1', 'local', [], transport)
            room.sendSignal('p2', { sdp: 'offer' })
            expect(transport.send).toHaveBeenCalledWith({
                type: MessageType.Signal,
                to: 'p2',
                data: { sdp: 'offer' },
            })
        })
    })
})
