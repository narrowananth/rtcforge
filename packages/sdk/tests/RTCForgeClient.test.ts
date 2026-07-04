import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RTCForgeClient } from '../src/RTCForgeClient.js'
import { MessageType } from '../src/protocol.js'
import { ClientEvent, RoomEvent } from '../src/types.js'

type WsEventMap = {
    onopen: (() => void) | null
    onclose: ((ev: { code: number; reason: string }) => void) | null
    onmessage: ((ev: { data: string }) => void) | null
    onerror: (() => void) | null
}

class MockWS implements WsEventMap {
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

    message(data: unknown): void {
        this.onmessage?.({ data: JSON.stringify(data) })
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

describe('RTCForgeClient', () => {
    beforeEach(() => {
        MockWS.instances = []
        Object.defineProperty(globalThis, 'WebSocket', {
            value: MockWS,
            configurable: true,
            writable: true,
        })
    })

    afterEach(() => {
        // biome-ignore lint/performance/noDelete: test cleanup — must fully remove the property so typeof check returns 'undefined'
        delete (globalThis as Record<string, unknown>).WebSocket
    })

    function latestWs(): MockWS {
        return MockWS.instances[MockWS.instances.length - 1]
    }

    it('joinRoom resolves with Room on room-joined', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000' })
        const promise = client.joinRoom('r1')
        await tick()

        const ws = latestWs()
        ws.open()
        ws.message({ type: MessageType.RoomJoined, roomId: 'r1', peerId: 'p1', peers: [] })

        const room = await promise
        expect(room.id).toBe('r1')
        expect(room.localPeerId).toBe('p1')
    })

    it('joinRoom rejects on error message', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000' })
        const promise = client.joinRoom('r1')
        await tick()

        const ws = latestWs()
        ws.open()
        ws.message({ type: MessageType.Error, code: 'FORBIDDEN', message: 'Not allowed' })

        await expect(promise).rejects.toThrow('Not allowed')
    })

    it('joinRoom rejects on WebSocket error', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000' })
        const promise = client.joinRoom('r1')
        await tick()

        latestWs().error()

        await expect(promise).rejects.toThrow('WebSocket error')
    })

    it('appends roomId to server URL', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000' })
        client.joinRoom('my-room')
        await tick()
        expect(latestWs().url).toContain('roomId=my-room')
    })

    it('appends token to URL when provided', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000', token: 'jwt-abc' })
        client.joinRoom('r1')
        await tick()
        expect(latestWs().url).toContain('token=jwt-abc')
    })

    it('appends peerId to URL in no-auth mode (no token)', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000', peerId: 'alice' })
        client.joinRoom('r1')
        await tick()
        expect(latestWs().url).toContain('peerId=alice')
        expect(latestWs().url).not.toContain('token=')
    })

    it('prefers token over peerId when both provided', async () => {
        const client = new RTCForgeClient({
            serverUrl: 'ws://localhost:3000',
            token: 'jwt',
            peerId: 'alice',
        })
        client.joinRoom('r1')
        await tick()
        expect(latestWs().url).toContain('token=jwt')
        expect(latestWs().url).not.toContain('peerId=')
    })

    it('emits connected after room-joined', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000' })
        const connectedListener = vi.fn()
        client.on(ClientEvent.Connected, connectedListener)

        const promise = client.joinRoom('r1')
        await tick()

        const ws = latestWs()
        ws.open()
        ws.message({ type: MessageType.RoomJoined, roomId: 'r1', peerId: 'p1', peers: [] })

        await promise
        expect(connectedListener).toHaveBeenCalled()
    })

    it('emits disconnected on WebSocket close', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000', reconnect: false })
        const listener = vi.fn()
        client.on(ClientEvent.Disconnected, listener)

        const promise = client.joinRoom('r1')
        await tick()

        const ws = latestWs()
        ws.open()
        ws.message({ type: MessageType.RoomJoined, roomId: 'r1', peerId: 'p1', peers: [] })
        await promise

        ws.closeWith(1001, 'Going away')
        expect(listener).toHaveBeenCalledWith(1001, 'Going away')
    })

    it('leave closes transport and clears room', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000', reconnect: false })
        const promise = client.joinRoom('r1')
        await tick()

        const ws = latestWs()
        ws.open()
        ws.message({ type: MessageType.RoomJoined, roomId: 'r1', peerId: 'p1', peers: [] })
        const room = await promise

        const closedListener = vi.fn()
        room.on(RoomEvent.Closed, closedListener)

        await client.leave()
        expect(closedListener).toHaveBeenCalled()
        expect(ws.close).toHaveBeenCalled()
    })

    it('passes subsequent room-joined to _refresh after initial join', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000', reconnect: false })
        const promise = client.joinRoom('r1')
        await tick()

        const ws = latestWs()
        ws.open()
        ws.message({ type: MessageType.RoomJoined, roomId: 'r1', peerId: 'p1', peers: ['p2'] })
        const room = await promise
        expect(room.peers).toContain('p2')

        ws.message({ type: MessageType.RoomJoined, roomId: 'r1', peerId: 'p1', peers: ['p3'] })
        expect(room.peers).toContain('p3')
        expect(room.peers).not.toContain('p2')
    })

    it('stops reconnecting after maxReconnectAttempts', async () => {
        vi.useFakeTimers()
        const client = new RTCForgeClient({
            serverUrl: 'ws://localhost:3000',
            reconnect: true,
            maxReconnectAttempts: 2,
        })
        const promise = client.joinRoom('r1')
        await tick()

        const ws0 = latestWs()
        ws0.open()
        ws0.message({ type: MessageType.RoomJoined, roomId: 'r1', peerId: 'p1', peers: [] })
        await promise

        const countBefore = MockWS.instances.length

        ws0.closeWith(1006, 'dropped')
        vi.runAllTimers()
        await tick()

        latestWs().closeWith(1006, 'fail')
        vi.runAllTimers()
        await tick()

        latestWs().closeWith(1006, 'fail')
        vi.runAllTimers()
        await tick()

        expect(MockWS.instances.length - countBefore).toBe(2)

        vi.useRealTimers()
    })

    it('a 1008 close before room-joined rejects joinRoom now (not after timeout) and emits Terminated', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000', reconnect: true })
        const terminated = vi.fn()
        client.on(ClientEvent.Terminated, terminated)
        const promise = client.joinRoom('r1')
        await tick()

        const ws = latestWs()
        ws.open() // socket opens, but server rejects before room-joined
        ws.closeWith(1008, 'bad token')

        await expect(promise).rejects.toThrow(/terminated|1008/i)
        expect(terminated).toHaveBeenCalledWith(1008, 'bad token')

        // Client is reset — a fresh join works without leave() (no "Already in a room").
        const p2 = client.joinRoom('r1')
        await tick()
        const ws2 = latestWs()
        ws2.open()
        ws2.message({ type: MessageType.RoomJoined, roomId: 'r1', peerId: 'p1', peers: [] })
        await expect(p2).resolves.toBeTruthy()
    })

    it('logger receives info on connect and disconnect', async () => {
        const logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            fatal: vi.fn(),
        }
        const client = new RTCForgeClient({
            serverUrl: 'ws://localhost:3000',
            reconnect: false,
            logger,
        })
        const promise = client.joinRoom('r1')
        await tick()

        const ws = latestWs()
        ws.open()
        ws.message({ type: MessageType.RoomJoined, roomId: 'r1', peerId: 'p1', peers: [] })
        await promise

        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('connected'),
            expect.any(Object),
        )

        ws.closeWith(1000, 'normal')
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('closed'),
            expect.any(Object),
        )
    })
})
