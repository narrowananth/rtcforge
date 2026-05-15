import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RTCForgeClient } from '../src/RTCForgeClient.js'
import { MessageType } from '../src/protocol.js'

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

    it('emits connected after room-joined', async () => {
        const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3000' })
        const connectedListener = vi.fn()
        client.on('connected', connectedListener)

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
        client.on('disconnected', listener)

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
        room.on('closed', closedListener)

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
})
