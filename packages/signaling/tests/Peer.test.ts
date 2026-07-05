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
        peer = new Peer({ id: 'p1', role: 'participant', ws: ws as never, onSignal })
        // Most tests exercise a peer that has already been admitted to a room.
        peer.admit()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('sends JSON-encoded message when OPEN', () => {
        peer.send({ type: MessageType.Ping })
        expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: MessageType.Ping }))
    })

    it('throws when WebSocket is not OPEN', () => {
        ws.readyState = 3
        expect(() => peer.send({ type: MessageType.Ping })).toThrow('not open')
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

    it('surfaces a raw socket error via PeerEvent.Error instead of crashing', () => {
        // Regression: with no 'error' listener, a raw ws error is an
        // uncaughtException that kills the whole server (REVIEW.md CRITICAL #1).
        const onError = vi.fn()
        peer.on(PeerEvent.Error, onError)
        expect(() => ws.emit('error', new Error('ECONNRESET'))).not.toThrow()
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'ECONNRESET' }))
    })

    it('rate-limits every frame type (malformed and pong floods are bounded)', () => {
        const limited = new Peer({ id: 'p9', ws: ws as never, onSignal, maxMessagesPerSecond: 1 })
        const onLimit = vi.fn()
        limited.on(PeerEvent.RateLimitExceeded, onLimit)
        // First frame consumes the budget of 1; subsequent ones (incl. pong and
        // garbage) are dropped by the limiter, not parsed/handled.
        ws.emit('message', Buffer.from(JSON.stringify({ type: MessageType.Pong })))
        ws.emit('message', Buffer.from(JSON.stringify({ type: MessageType.Pong })))
        ws.emit('message', Buffer.from('garbage{'))
        expect(onLimit).toHaveBeenCalledTimes(2)
    })

    it('treats any accepted frame as liveness so a busy peer is not pruned', () => {
        vi.useFakeTimers()
        const before = peer.lastPong
        vi.advanceTimersByTime(50)
        // A non-pong frame (broadcast) still advances liveness.
        ws.emit(
            'message',
            Buffer.from(JSON.stringify({ type: MessageType.Broadcast, channel: 'c' })),
        )
        expect(peer.lastPong).toBeGreaterThan(before)
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
        vi.useFakeTimers()
        const before = peer.lastPong
        vi.advanceTimersByTime(10)
        ws.emit('message', Buffer.from(JSON.stringify({ type: MessageType.Pong })))
        expect(peer.lastPong).toBeGreaterThan(before)
    })

    it('emits disconnected when WebSocket closes', () => {
        const listener = vi.fn()
        peer.on(PeerEvent.Disconnected, listener)
        ws.emit('close', 1001, Buffer.from('Going away'))
        expect(listener).toHaveBeenCalledWith(1001, 'Going away')
    })

    it('ignores signal and broadcast frames until admitted', () => {
        // Regression: an un-admitted peer must not relay/broadcast during the
        // async admission window (SignalingServer iceServersHook await).
        const gatedWs = new MockWs()
        const gated = new Peer({ id: 'g1', ws: gatedWs as never, onSignal })
        const onBroadcast = vi.fn()
        gated.on(PeerEvent.Broadcast, onBroadcast)
        gatedWs.emit(
            'message',
            Buffer.from(JSON.stringify({ type: MessageType.Signal, to: 'x', data: { a: 1 } })),
        )
        gatedWs.emit(
            'message',
            Buffer.from(JSON.stringify({ type: MessageType.Broadcast, channel: 'c' })),
        )
        expect(onSignal).not.toHaveBeenCalled()
        expect(onBroadcast).not.toHaveBeenCalled()

        gated.admit()
        gatedWs.emit(
            'message',
            Buffer.from(JSON.stringify({ type: MessageType.Signal, to: 'x', data: { a: 1 } })),
        )
        expect(onSignal).toHaveBeenCalledWith('x', { a: 1 })
    })

    it('disconnects a peer whose send buffer exceeds the cap instead of buffering', () => {
        const bp = new Peer({ id: 'bp', ws: ws as never, onSignal, maxBufferedBytes: 10 })
        const onError = vi.fn()
        bp.on(PeerEvent.Error, onError)
        ;(ws as unknown as { bufferedAmount: number }).bufferedAmount = 100
        bp.send({ type: MessageType.Ping })
        expect(ws.close).toHaveBeenCalled()
        expect(ws.send).not.toHaveBeenCalled()
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('max buffered bytes') }),
        )
    })

    it('truncateUtf8 does not leave a lone surrogate in the close reason', () => {
        // 120 ASCII bytes + a 4-byte emoji (UTF-16 surrogate pair) = 124 bytes;
        // trimming to the 123-byte cap strands the high surrogate.
        const reason = `${'a'.repeat(120)}\u{1F600}`
        peer.disconnect(1000, reason)
        const passed = ws.close.mock.calls[0][1] as string
        expect(Buffer.byteLength(passed, 'utf8')).toBeLessThanOrEqual(123)
        const last = passed.charCodeAt(passed.length - 1)
        expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    })

    it('emits PeerEvent.Error on malformed JSON messages', () => {
        const errorListener = vi.fn()
        peer.on(PeerEvent.Error, errorListener)
        expect(() => {
            ws.emit('message', Buffer.from('not-valid-json{'))
        }).not.toThrow()
        expect(errorListener).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('JSON parse error') }),
        )
        expect(onSignal).not.toHaveBeenCalled()
    })
})
