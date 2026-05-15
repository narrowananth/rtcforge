import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { SignalingServer } from '../src/SignalingServer.js'
import { MessageType } from '../src/protocol.js'
import { PeerRole } from '../src/types.js'

interface TestClient {
    ws: WebSocket
    nextMessage(): Promise<unknown>
    close(): void
}

function connect(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url)
        const queue: unknown[] = []
        const waiters: Array<(msg: unknown) => void> = []

        // Register message listener immediately — before 'open' fires —
        // so we never miss a message that arrives in the same TCP frame as the 101.
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString())
            const waiter = waiters.shift()
            if (waiter) {
                waiter(msg)
            } else {
                queue.push(msg)
            }
        })

        ws.once('open', () =>
            resolve({
                ws,
                nextMessage: () =>
                    new Promise<unknown>((res) => {
                        if (queue.length > 0) {
                            res(queue.shift() as unknown)
                        } else {
                            waiters.push(res)
                        }
                    }),
                close: () => ws.close(),
            }),
        )
        ws.once('error', reject)
    })
}

async function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
    return new Promise((resolve) => {
        ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    })
}

describe('SignalingServer', () => {
    let server: SignalingServer
    let port: number
    const openClients: WebSocket[] = []

    beforeEach(async () => {
        server = new SignalingServer({ port: 0 })
        await server.start()
        port = (server as never as { ownServer: { address(): AddressInfo } }).ownServer.address()
            .port
    })

    afterEach(async () => {
        for (const ws of openClients) {
            if (ws.readyState === WebSocket.OPEN) ws.close()
        }
        openClients.length = 0
        await server.stop()
    })

    function url(roomId: string, peerId: string): string {
        return `ws://localhost:${port}?roomId=${roomId}&peerId=${peerId}`
    }

    it('sends room-joined on connection (no auth)', async () => {
        const c = await connect(url('r1', 'p1'))
        openClients.push(c.ws)
        const msg = await c.nextMessage()
        expect(msg).toMatchObject({
            type: MessageType.RoomJoined,
            roomId: 'r1',
            peerId: 'p1',
            peers: [],
        })
        c.close()
    })

    it('second peer receives peers list with first peer ID', async () => {
        const c1 = await connect(url('r1', 'p1'))
        openClients.push(c1.ws)
        await c1.nextMessage() // room-joined for p1

        const c2 = await connect(url('r1', 'p2'))
        openClients.push(c2.ws)
        const msg = await c2.nextMessage()
        expect(msg).toMatchObject({
            type: MessageType.RoomJoined,
            roomId: 'r1',
            peerId: 'p2',
            peers: ['p1'],
        })
        c1.close()
        c2.close()
    })

    it('first peer receives peer-joined when second peer connects', async () => {
        const c1 = await connect(url('r1', 'p1'))
        openClients.push(c1.ws)
        await c1.nextMessage() // consume room-joined

        const c2 = await connect(url('r1', 'p2'))
        openClients.push(c2.ws)
        await c2.nextMessage() // consume room-joined

        const msg = await c1.nextMessage() // peer-joined notification
        expect(msg).toMatchObject({ type: MessageType.PeerJoined, peerId: 'p2' })
        c1.close()
        c2.close()
    })

    it('emits roomCreated when first peer joins a room', async () => {
        const listener = vi.fn()
        server.on('roomCreated', listener)
        const c = await connect(url('r2', 'p1'))
        openClients.push(c.ws)
        await c.nextMessage()
        expect(listener).toHaveBeenCalledTimes(1)
        c.close()
    })

    it('relays signal messages between peers', async () => {
        const c1 = await connect(url('r1', 'p1'))
        const c2 = await connect(url('r1', 'p2'))
        openClients.push(c1.ws, c2.ws)
        await c1.nextMessage() // room-joined
        await c2.nextMessage() // room-joined
        await c1.nextMessage() // peer-joined for p2

        c1.ws.send(
            JSON.stringify({ type: MessageType.Signal, to: 'p2', data: { candidate: 'ice' } }),
        )
        const msg = await c2.nextMessage()
        expect(msg).toMatchObject({
            type: MessageType.Signal,
            from: 'p1',
            data: { candidate: 'ice' },
        })
        c1.close()
        c2.close()
    })

    it('closes connection when roomId or peerId is missing (no auth)', async () => {
        const ws = new WebSocket(`ws://localhost:${port}?roomId=r1`)
        openClients.push(ws)
        const { code } = await waitClose(ws)
        expect(code).toBe(1008)
    })

    it('calls auth function and rejects on throw', async () => {
        const authServer = new SignalingServer({
            port: 0,
            auth: async () => {
                throw new Error('Unauthorized')
            },
        })
        await authServer.start()
        const authPort = (
            authServer as never as { ownServer: { address(): AddressInfo } }
        ).ownServer.address().port

        const ws = new WebSocket(`ws://localhost:${authPort}?token=bad`)
        const { code } = await waitClose(ws)
        expect(code).toBe(1008)
        await authServer.stop()
    })

    it('calls auth function and accepts on valid token', async () => {
        const authServer = new SignalingServer({
            port: 0,
            auth: async () => ({
                roomId: 'auth-room',
                peerId: 'auth-peer',
                role: PeerRole.Participant,
            }),
        })
        await authServer.start()
        const authPort = (
            authServer as never as { ownServer: { address(): AddressInfo } }
        ).ownServer.address().port

        const c = await connect(`ws://localhost:${authPort}?token=valid`)
        const msg = await c.nextMessage()
        expect(msg).toMatchObject({
            type: MessageType.RoomJoined,
            roomId: 'auth-room',
            peerId: 'auth-peer',
        })
        c.close()
        await authServer.stop()
    })
})
