import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Peer } from '../src/Peer.js'
import { MessageType } from '../src/protocol.js'
import { PeerEvent } from '../src/types.js'

class MockWs extends EventEmitter {
    readyState = 1
    send = vi.fn()
    close = vi.fn()
}

describe('Peer', () => {
    let ws: MockWs
    let onSignal: ReturnType<typeof vi.fn>
    let peer: Peer

    beforeEach(() => {
        ws = new MockWs()
        onSignal = vi.fn()
        peer = new Peer('p1', 'participant', ws as never, onSignal)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('sends JSON-encoded message when OPEN', () => {
        peer.send({ type: MessageType.Ping })
        expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: MessageType.Ping }))
    })

    it('skips send when WebSocket is not OPEN', () => {
        ws.readyState = 3
        peer.send({ type: MessageType.Ping })
        expect(ws.send).not.toHaveBeenCalled()
    })

    it('ping sends ping message', () => {
        peer.ping()
        expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: MessageType.Ping }))
    })

    it('disconnect closes WebSocket with code and reason', () => {
        peer.disconnect(1000, 'Normal closure')
        expect(ws.close).toHaveBeenCalledWith(1000, 'Normal closure')
    })

    it('calls onSignal when signal message received', () => {
        ws.emit(
            'message',
            Buffer.from(
                JSON.stringify({ type: MessageType.Signal, to: 'p2', data: { sdp: 'v=0' } }),
            ),
        )
        expect(onSignal).toHaveBeenCalledWith('p2', { sdp: 'v=0' })
    })

    it('updates lastPong when pong message received', () => {
        peer.lastPong = 0
        ws.emit('message', Buffer.from(JSON.stringify({ type: MessageType.Pong })))
        expect(peer.lastPong).toBeGreaterThan(0)
    })

    it('emits disconnected when WebSocket closes', () => {
        const listener = vi.fn()
        peer.on(PeerEvent.Disconnected, listener)
        ws.emit('close', 1001, Buffer.from('Going away'))
        expect(listener).toHaveBeenCalledWith(1001, 'Going away')
    })

    it('ignores malformed JSON messages silently', () => {
        expect(() => {
            ws.emit('message', Buffer.from('not-valid-json{'))
        }).not.toThrow()
        expect(onSignal).not.toHaveBeenCalled()
    })
})
