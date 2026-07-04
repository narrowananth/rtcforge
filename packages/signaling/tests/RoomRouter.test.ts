import type { AddressInfo } from 'node:net'
import { HashRing, MemoryMembership } from 'rtcforge-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { RoomRouter } from '../src/RoomRouter.js'
import { SignalingServer } from '../src/SignalingServer.js'
import { CloseCode } from '../src/types.js'

describe('RoomRouter', () => {
    it('self always owns a share, even before membership converges', () => {
        const r = new RoomRouter({ selfId: 'self', membership: new MemoryMembership() })
        expect(r.nodeIds()).toEqual(['self'])
        expect(r.isLocal('any-room')).toBe(true)
        expect(r.owner('any-room')?.id).toBe('self')
    })

    it('tracks the fleet via membership and routes deterministically', async () => {
        const m = new MemoryMembership()
        const r = new RoomRouter({ selfId: 'self', membership: m })
        await m.register({ id: 'self' }, 10_000)
        await m.register({ id: 'b' }, 10_000)
        await m.register({ id: 'c' }, 10_000)
        expect(r.nodeIds().sort()).toEqual(['b', 'c', 'self'])

        const ring = new HashRing(['self', 'b', 'c'])
        for (let i = 0; i < 200; i++) {
            const room = `room:${i}`
            expect(r.ownerId(room)).toBe(ring.get(room))
            expect(r.isLocal(room)).toBe(ring.get(room) === 'self')
        }
    })

    it('drops nodes that leave the fleet but never drops self', async () => {
        const m = new MemoryMembership()
        const r = new RoomRouter({ selfId: 'self', membership: m })
        await m.register({ id: 'b' }, 10_000)
        expect(r.nodeIds().sort()).toEqual(['b', 'self'])
        await m.deregister('b')
        expect(r.nodeIds()).toEqual(['self'])

        await m.register({ id: 'b' }, 10_000)
        await m.deregister('self')
        expect(r.nodeIds()).toContain('self')
    })

    it('weights nodes by capacity metadata', async () => {
        const m = new MemoryMembership()
        const r = new RoomRouter({ selfId: 'self', membership: m })
        await m.register({ id: 'big', metadata: { capacity: '8' } }, 10_000)
        let big = 0
        for (let i = 0; i < 2000; i++) if (r.ownerId(`room:${i}`) === 'big') big++

        expect(big / 2000).toBeGreaterThan(0.6)
    })

    it('dispose stops tracking the fleet', async () => {
        const m = new MemoryMembership()
        const r = new RoomRouter({ selfId: 'self', membership: m })
        r.dispose()
        await m.register({ id: 'b' }, 10_000)
        expect(r.nodeIds()).toEqual(['self'])
    })
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Ephemeral (port: 0) servers recycle ports across parallel workers, so a fresh
// client occasionally races the http→ws upgrade and sees a transient 'error'.
// Retry the whole connect until the expected outcome (close / first message).
async function connectExpectClose(
    url: string,
    open: WebSocket[],
    attempts = 5,
): Promise<{ code: number; reason: string }> {
    for (let i = 0; i < attempts; i++) {
        const ws = new WebSocket(url)
        open.push(ws)
        const r = await new Promise<{ code: number; reason: string } | null>((resolve) => {
            ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
            ws.once('error', () => resolve(null))
        })
        if (r) return r
        await sleep(15)
    }
    throw new Error('connectExpectClose: exhausted retries')
}

async function connectExpectMessage(
    url: string,
    open: WebSocket[],
    attempts = 5,
): Promise<unknown> {
    for (let i = 0; i < attempts; i++) {
        const ws = new WebSocket(url)
        open.push(ws)
        const r = await new Promise<unknown>((resolve) => {
            ws.once('message', (d) => resolve(JSON.parse(d.toString())))
            ws.once('error', () => resolve(null))
        })
        if (r !== null) return r
        await sleep(15)
    }
    throw new Error('connectExpectMessage: exhausted retries')
}

describe('SignalingServer — shared-nothing redirect', () => {
    let server: SignalingServer
    const open: WebSocket[] = []

    afterEach(async () => {
        for (const ws of open) if (ws.readyState === WebSocket.OPEN) ws.close()
        open.length = 0
        await server.stop()
    })

    it('redirects a peer whose room is owned by another node; serves local rooms normally', async () => {
        const membership = new MemoryMembership()
        const onRedirect = vi.fn()
        server = new SignalingServer({
            port: 0,
            cluster: { selfId: 'self', membership },
            onRedirect,
        })
        await membership.register({ id: 'other' }, 60_000)
        await server.start()
        const port = (
            server as never as { ownServer: { address(): AddressInfo } }
        ).ownServer.address().port

        const ring = new HashRing(['self', 'other'])
        const remoteRoom = Array.from({ length: 500 }, (_, i) => `room:${i}`).find(
            (r) => ring.get(r) === 'other',
        ) as string
        const localRoom = Array.from({ length: 500 }, (_, i) => `room:${i}`).find(
            (r) => ring.get(r) === 'self',
        ) as string

        const closed = await connectExpectClose(
            `ws://localhost:${port}?roomId=${remoteRoom}&peerId=p1`,
            open,
        )
        expect(closed.code).toBe(CloseCode.PolicyViolation)
        expect(onRedirect).toHaveBeenCalledWith(
            'p1',
            remoteRoom,
            expect.objectContaining({ id: 'other' }),
        )
        expect(server.getOwner(remoteRoom)?.id).toBe('other')

        const msg = await connectExpectMessage(
            `ws://localhost:${port}?roomId=${localRoom}&peerId=p2`,
            open,
        )
        expect(msg).toMatchObject({ type: 'room-joined', roomId: localRoom, peerId: 'p2' })
        expect(server.getOwner(localRoom)?.id).toBe('self')
    })
})
