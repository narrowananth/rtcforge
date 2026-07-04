import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { SignalingServer } from '../src/SignalingServer.js'
import { MessageType } from '../src/protocol.js'
import { ServerEvent } from '../src/types.js'
import type { Logger, MetricsCollector } from '../src/types.js'

interface TestClient {
    ws: WebSocket
    nextMessage(): Promise<unknown>
    close(): void
}

function connectOnce(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url)
        const queue: unknown[] = []
        const waiters: Array<(msg: unknown) => void> = []

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

// Ephemeral (port: 0) servers are cycled rapidly across tests and the OS can
// recycle a just-freed port, so a fresh client occasionally races the http→ws
// upgrade wiring and sees a transient "Unexpected server response: 200"/reset.
// Retry a bounded number of times; a genuinely broken server fails all attempts.
async function connect(url: string): Promise<TestClient> {
    let lastErr: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            return await connectOnce(url)
        } catch (err) {
            lastErr = err
            await new Promise((r) => setTimeout(r, 15))
        }
    }
    throw lastErr
}

async function waitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
    return new Promise((resolve) => {
        ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    })
}

// Connect and wait for the server to close us, retrying on a transient connect
// 'error' (an ephemeral port recycled onto another worker's server — see the
// connect() note). A legitimate rejection closes the upgraded socket with a
// code, so this returns that; only pre-upgrade errors are retried.
async function awaitClose(url: string, attempts = 5): Promise<{ code: number; reason: string }> {
    let lastErr: unknown
    for (let i = 0; i < attempts; i++) {
        const ws = new WebSocket(url)
        const result = await new Promise<{ code: number; reason: string } | null>((resolve) => {
            ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
            ws.once('error', (err) => {
                lastErr = err
                resolve(null)
            })
        })
        if (result) return result
        await new Promise((r) => setTimeout(r, 15))
    }
    throw lastErr ?? new Error('awaitClose: exhausted retries')
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
        await c1.nextMessage()

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
        await c1.nextMessage()

        const c2 = await connect(url('r1', 'p2'))
        openClients.push(c2.ws)
        await c2.nextMessage()

        const msg = await c1.nextMessage()
        expect(msg).toMatchObject({ type: MessageType.PeerJoined, peerId: 'p2' })
        c1.close()
        c2.close()
    })

    it('emits roomCreated when first peer joins a room', async () => {
        const listener = vi.fn()
        server.on(ServerEvent.RoomCreated, listener)
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
        await c1.nextMessage()
        await c2.nextMessage()
        await c1.nextMessage()

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
        const { code } = await awaitClose(`ws://localhost:${port}?roomId=r1`)
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

        const { code } = await awaitClose(`ws://localhost:${authPort}?token=bad`)
        expect(code).toBe(1008)
        await authServer.stop()
    })

    it('calls auth function and accepts on valid token', async () => {
        const authServer = new SignalingServer({
            port: 0,
            auth: async () => ({
                roomId: 'auth-room',
                peerId: 'auth-peer',
                role: 'participant',
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

describe('SignalingServer — Phase 3: observability & reliability', () => {
    let server: SignalingServer
    let port: number
    const openClients: WebSocket[] = []

    function makeLogger(): Logger {
        return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }
    }

    function makeMetrics(): MetricsCollector {
        return { increment: vi.fn(), gauge: vi.fn(), histogram: vi.fn(), timing: vi.fn() }
    }

    function url(roomId: string, peerId: string): string {
        return `ws://localhost:${port}?roomId=${roomId}&peerId=${peerId}`
    }

    afterEach(async () => {
        for (const ws of openClients) {
            if (ws.readyState === WebSocket.OPEN) ws.close()
        }
        openClients.length = 0
        if (server) await server.stop()
    })

    it('getStats returns correct room and peer counts', async () => {
        server = new SignalingServer({ port: 0 })
        await server.start()
        port = (server as never as { ownServer: { address(): AddressInfo } }).ownServer.address()
            .port

        expect(server.getStats()).toMatchObject({ rooms: 0, peers: 0 })

        const c1 = await connect(url('r1', 'p1'))
        openClients.push(c1.ws)
        await c1.nextMessage()

        const c2 = await connect(url('r1', 'p2'))
        openClients.push(c2.ws)
        await c2.nextMessage()

        const stats = server.getStats()
        expect(stats.rooms).toBe(1)
        expect(stats.peers).toBe(2)
        expect(stats.uptime).toBeGreaterThan(0)

        c1.close()
        c2.close()
    })

    it('getStats uptime is 0 before start', () => {
        server = new SignalingServer({ port: 0 })
        expect(server.getStats().uptime).toBe(0)
    })

    it('start() twice rejects instead of leaking a second server', async () => {
        server = new SignalingServer({ port: 0 })
        await server.start()
        await expect(server.start()).rejects.toThrow(/already started/)
    })

    it('logger receives info calls on peer join and room creation', async () => {
        const logger = makeLogger()
        server = new SignalingServer({ port: 0, logger })
        await server.start()
        port = (server as never as { ownServer: { address(): AddressInfo } }).ownServer.address()
            .port

        const c = await connect(url('r2', 'p1'))
        openClients.push(c.ws)
        await c.nextMessage()

        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('Room created'),
            expect.objectContaining({ roomId: 'r2' }),
        )
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('Peer joined'),
            expect.objectContaining({ peerId: 'p1' }),
        )
        c.close()
    })

    it('logger.warn called on auth failure', async () => {
        const logger = makeLogger()
        const authServer = new SignalingServer({
            port: 0,
            logger,
            auth: async () => {
                throw new Error('bad token')
            },
        })
        await authServer.start()
        const authPort = (
            authServer as never as { ownServer: { address(): AddressInfo } }
        ).ownServer.address().port

        await awaitClose(`ws://localhost:${authPort}?token=bad`)
        await authServer.stop()

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Auth failed'),
            expect.any(Object),
        )
    })

    it('metrics increments rooms_created and peers_connected', async () => {
        const metrics = makeMetrics()
        server = new SignalingServer({ port: 0, metrics })
        await server.start()
        port = (server as never as { ownServer: { address(): AddressInfo } }).ownServer.address()
            .port

        const c = await connect(url('r3', 'p1'))
        openClients.push(c.ws)
        await c.nextMessage()

        expect(metrics.increment).toHaveBeenCalledWith('rooms_created')
        expect(metrics.increment).toHaveBeenCalledWith('peers_connected', expect.any(Object))
        expect(metrics.gauge).toHaveBeenCalledWith('active_rooms', 1)
        c.close()
    })

    it('stop() closes all connected peers gracefully', async () => {
        server = new SignalingServer({ port: 0 })
        await server.start()
        port = (server as never as { ownServer: { address(): AddressInfo } }).ownServer.address()
            .port

        const c1 = await connect(url('r1', 'p1'))
        const c2 = await connect(url('r1', 'p2'))
        openClients.push(c1.ws, c2.ws)
        await c1.nextMessage()
        await c2.nextMessage()

        const [close1, close2] = [waitClose(c1.ws), waitClose(c2.ws)]
        await server.stop()
        const [r1, r2] = await Promise.all([close1, close2])
        expect(r1.code).toBe(1000)
        expect(r2.code).toBe(1000)
    })
})

describe('SignalingServer — presence & moderation', () => {
    let server: SignalingServer
    let port: number
    const openClients: WebSocket[] = []

    function url(roomId: string, peerId: string): string {
        return `ws://localhost:${port}?roomId=${roomId}&peerId=${peerId}`
    }

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

    it('broadcasts presence-online when a peer joins', async () => {
        const c1 = await connect(url('r1', 'p1'))
        openClients.push(c1.ws)
        await c1.nextMessage()

        const c2 = await connect(url('r1', 'p2'))
        openClients.push(c2.ws)
        await c2.nextMessage()

        await c1.nextMessage()
        const presence = await c1.nextMessage()
        expect(presence).toMatchObject({ type: MessageType.PresenceOnline, peerId: 'p2' })

        c1.close()
        c2.close()
    })

    it('broadcasts presence-offline when a peer disconnects', async () => {
        const c1 = await connect(url('r1', 'p1'))
        const c2 = await connect(url('r1', 'p2'))
        openClients.push(c1.ws, c2.ws)
        await c1.nextMessage()
        await c2.nextMessage()
        await c1.nextMessage()
        await c1.nextMessage()

        c2.close()
        await c1.nextMessage()
        const presenceOffline = await c1.nextMessage()
        expect(presenceOffline).toMatchObject({ type: MessageType.PresenceOffline, peerId: 'p2' })

        c1.close()
    })

    it('kicks peer when kickPeer is called on Room', async () => {
        const c1 = await connect(url('r1', 'p1'))
        openClients.push(c1.ws)
        await c1.nextMessage()

        let capturedRoom: import('../src/Room.js').Room | undefined
        server.on(ServerEvent.RoomCreated, (room) => {
            capturedRoom = room
        })

        const kickServer = new SignalingServer({ port: 0 })
        await kickServer.start()
        const kickPort = (
            kickServer as never as { ownServer: { address(): AddressInfo } }
        ).ownServer.address().port
        kickServer.on(ServerEvent.RoomCreated, (room) => {
            capturedRoom = room
        })

        const target = await connect(`ws://localhost:${kickPort}?roomId=kr&peerId=victim`)
        await target.nextMessage()

        const closePromise = waitClose(target.ws)
        if (!capturedRoom) throw new Error('capturedRoom not set')
        capturedRoom.kickPeer('victim', 'testing kick')
        const { code } = await closePromise
        expect(code).toBe(1008)

        target.close()
        await kickServer.stop()
        c1.close()
    })
})

describe('SignalingServer — maxPeersPerRoom', () => {
    it('rejects the (N+1)th peer with close code 1008', async () => {
        const limitServer = new SignalingServer({ port: 0, maxPeersPerRoom: 1 })
        await limitServer.start()
        const limitPort = (
            limitServer as never as { ownServer: { address(): AddressInfo } }
        ).ownServer.address().port

        const c1 = await connect(`ws://localhost:${limitPort}?roomId=r1&peerId=p1`)
        await c1.nextMessage()

        const { code } = await awaitClose(`ws://localhost:${limitPort}?roomId=r1&peerId=p2`)
        expect(code).toBe(1008)

        c1.close()
        await limitServer.stop()
    })
})

describe('SignalingServer — health endpoint', () => {
    it('GET /health returns JSON stats', async () => {
        const httpServer = http.createServer()
        const sigServer = new SignalingServer({ server: httpServer })
        sigServer.attachHealthEndpoint(httpServer)
        await sigServer.start()
        await new Promise<void>((resolve) => httpServer.listen(0, resolve))

        const addr = httpServer.address() as AddressInfo
        // Tolerate transient cross-worker ephemeral-port collisions (a recycled
        // port briefly served by another test's server) by retrying for JSON.
        let body: Record<string, unknown> | undefined
        for (let attempt = 0; attempt < 5; attempt++) {
            const res = await fetch(`http://localhost:${addr.port}/health`)
            const text = await res.text()
            try {
                body = JSON.parse(text) as Record<string, unknown>
                expect(res.status).toBe(200)
                break
            } catch {
                await new Promise((r) => setTimeout(r, 20))
            }
        }
        expect(body).toMatchObject({ status: 'ok', rooms: 0, peers: 0 })
        expect(typeof body?.uptime).toBe('number')

        await sigServer.stop()
        await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    })
})
