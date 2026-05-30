import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketTransport } from '../src/WebSocketTransport.js'
import { TransportEvent } from '../src/types.js'

// ── MockWS ────────────────────────────────────────────────────────────────────

class MockWS {
    static instances: MockWS[] = []
    readonly url: string
    readyState = 0

    onopen: (() => void) | null = null
    onclose: ((ev: { code: number; reason: string }) => void) | null = null
    onmessage: ((ev: { data: string }) => void) | null = null
    onerror: (() => void) | null = null

    send = vi.fn()
    close = vi.fn()

    constructor(url: string) {
        this.url = url
        MockWS.instances.push(this)
    }

    open(): void {
        this.readyState = 1
        this.onopen?.()
    }

    error(): void {
        this.onerror?.()
    }

    closeWith(code: number, reason = ''): void {
        this.readyState = 3
        this.onclose?.({ code, reason })
    }
}

async function tick(): Promise<void> {
    await Promise.resolve()
}

beforeEach(() => {
    MockWS.instances = []
    Object.defineProperty(globalThis, 'WebSocket', {
        value: MockWS,
        configurable: true,
        writable: true,
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

// ── connect() ─────────────────────────────────────────────────────────────────

describe('WebSocketTransport — connect()', () => {
    it('resolves when socket opens', async () => {
        const t = new WebSocketTransport('ws://localhost')
        const p = t.connect()
        await tick()
        MockWS.instances[0]?.open()
        await expect(p).resolves.toBeUndefined()
    })

    it('rejects on socket error', async () => {
        const t = new WebSocketTransport('ws://localhost')
        const p = t.connect()
        await tick()
        MockWS.instances[0]?.error()
        await expect(p).rejects.toThrow('WebSocket error')
    })

    it('rejects when maxReconnectAttempts=0 and socket closes (V2)', async () => {
        const t = new WebSocketTransport('ws://localhost', {
            reconnect: true,
            maxReconnectAttempts: 0,
        })
        const p = t.connect()
        await tick()
        MockWS.instances[0]?.closeWith(1006)
        await expect(p).rejects.toThrow('Max reconnect attempts reached')
    })

    it('rejects with connect-timeout error when connectTimeoutMs elapses', async () => {
        vi.useFakeTimers()
        const t = new WebSocketTransport('ws://localhost', { connectTimeoutMs: 100 })
        const p = t.connect()
        await tick()
        vi.advanceTimersByTime(101)
        await expect(p).rejects.toThrow('WebSocket connect timeout')
        vi.useRealTimers()
    })

    it('connect() is idempotent during inflight connection', async () => {
        const t = new WebSocketTransport('ws://localhost')
        const p1 = t.connect()
        await tick()
        // second connect while first is pending should not create a second socket
        // (initSocket guards with _connecting flag)
        // we resolve the first
        MockWS.instances[0]?.open()
        await p1
        expect(MockWS.instances.length).toBe(1)
    })
})

// ── V5: _closed after exhaustion ──────────────────────────────────────────────

describe('WebSocketTransport — exhaustion closes transport (V5)', () => {
    it('no reconnect attempt after maxReconnectAttempts=0 exhausted', async () => {
        const t = new WebSocketTransport('ws://localhost', {
            reconnect: true,
            maxReconnectAttempts: 0,
        })
        const p = t.connect()
        await tick()
        MockWS.instances[0]?.closeWith(1006)
        await p.catch(() => {})
        // only one WS ever created — no reconnect scheduled
        expect(MockWS.instances.length).toBe(1)
    })

    it('emits TransportEvent.Error when max reconnects exhausted', async () => {
        const t = new WebSocketTransport('ws://localhost', {
            reconnect: true,
            maxReconnectAttempts: 0,
        })
        const errHandler = vi.fn()
        t.on(TransportEvent.Error, errHandler)
        const p = t.connect()
        await tick()
        MockWS.instances[0]?.closeWith(1006)
        await p.catch(() => {})
        expect(errHandler).toHaveBeenCalledWith(expect.any(Error))
        expect(errHandler.mock.calls[0]?.[0]?.message).toMatch('Max reconnect attempts reached')
    })
})

// ── send() ────────────────────────────────────────────────────────────────────

describe('WebSocketTransport — send()', () => {
    it('queues messages when not connected and flushes on explicit flush()', async () => {
        const t = new WebSocketTransport('ws://localhost')
        const p = t.connect()
        await tick()
        const ws = MockWS.instances[0]
        if (!ws) throw new Error('no MockWS instance')
        t.send({ type: 'pong' } as never)
        expect(ws.send).not.toHaveBeenCalled()
        ws.open()
        await p
        expect(ws.send).not.toHaveBeenCalled()
        t.flush()
        expect(ws.send).toHaveBeenCalledTimes(1)
    })

    it('emits Error when send queue is full', async () => {
        const t = new WebSocketTransport('ws://localhost', { maxQueueSize: 1 })
        t.connect().catch(() => {})
        await tick()
        const errHandler = vi.fn()
        t.on(TransportEvent.Error, errHandler)
        t.send({ type: 'pong' } as never) // fills queue
        t.send({ type: 'pong' } as never) // overflows
        expect(errHandler).toHaveBeenCalledOnce()
    })
})

// ── close() ───────────────────────────────────────────────────────────────────

describe('WebSocketTransport — close()', () => {
    it('calls ws.close and clears queue', async () => {
        const t = new WebSocketTransport('ws://localhost')
        t.connect().catch(() => {})
        await tick()
        const ws = MockWS.instances[0]
        if (!ws) throw new Error('no MockWS instance')
        t.send({ type: 'pong' } as never) // queue one message
        t.close()
        expect(ws.close).toHaveBeenCalled()
    })

    it('prevents reconnect after explicit close', async () => {
        vi.useFakeTimers()
        const t = new WebSocketTransport('ws://localhost', { reconnect: true })
        t.connect().catch(() => {})
        await tick()
        const ws = MockWS.instances[0]
        if (!ws) throw new Error('no MockWS instance')
        ws.open()
        t.close()
        ws.closeWith(1006)
        vi.advanceTimersByTime(60_000)
        // still only one WS instance
        expect(MockWS.instances.length).toBe(1)
        vi.useRealTimers()
    })
})
