import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Consumer, ConsumerEvent } from '../src/Consumer.js'
import { MediaRouter, MediaRouterEvent } from '../src/MediaRouter.js'
import { MediaService, MediaServiceEvent } from '../src/MediaService.js'
import { Producer, ProducerEvent } from '../src/Producer.js'

// ── Producer ──────────────────────────────────────────────────────────────────

describe('Producer — state', () => {
    it('id starts with "producer-"', () => {
        const p = new Producer('peer-1', 'audio')
        expect(p.id).toMatch(/^producer-/)
    })

    it('kind and peerId set from constructor', () => {
        const p = new Producer('peer-1', 'video')
        expect(p.kind).toBe('video')
        expect(p.peerId).toBe('peer-1')
    })

    it('paused starts false', () => {
        expect(new Producer('peer-1', 'audio').paused).toBe(false)
    })

    it('closed starts false', () => {
        expect(new Producer('peer-1', 'audio').closed).toBe(false)
    })

    it('pause() sets paused and emits paused', () => {
        const p = new Producer('peer-1', 'audio')
        const fn = vi.fn()
        p.on(ProducerEvent.Paused, fn)
        p.pause()
        expect(p.paused).toBe(true)
        expect(fn).toHaveBeenCalledOnce()
    })

    it('pause() is idempotent', () => {
        const p = new Producer('peer-1', 'audio')
        const fn = vi.fn()
        p.on(ProducerEvent.Paused, fn)
        p.pause()
        p.pause()
        expect(fn).toHaveBeenCalledOnce()
    })

    it('resume() clears paused and emits resumed', () => {
        const p = new Producer('peer-1', 'audio')
        const fn = vi.fn()
        p.on(ProducerEvent.Resumed, fn)
        p.pause()
        p.resume()
        expect(p.paused).toBe(false)
        expect(fn).toHaveBeenCalledOnce()
    })

    it('resume() is no-op when not paused', () => {
        const p = new Producer('peer-1', 'audio')
        const fn = vi.fn()
        p.on(ProducerEvent.Resumed, fn)
        p.resume()
        expect(fn).not.toHaveBeenCalled()
    })

    it('close() sets closed and emits closed', () => {
        const p = new Producer('peer-1', 'audio')
        const fn = vi.fn()
        p.on(ProducerEvent.Closed, fn)
        p.close()
        expect(p.closed).toBe(true)
        expect(fn).toHaveBeenCalledOnce()
    })

    it('close() is idempotent', () => {
        const p = new Producer('peer-1', 'audio')
        const fn = vi.fn()
        p.on(ProducerEvent.Closed, fn)
        p.close()
        p.close()
        expect(fn).toHaveBeenCalledOnce()
    })

    it('pause() is no-op when closed', () => {
        const p = new Producer('peer-1', 'audio')
        p.close()
        const fn = vi.fn()
        p.on(ProducerEvent.Paused, fn)
        p.pause()
        expect(fn).not.toHaveBeenCalled()
    })
})

// ── Consumer ──────────────────────────────────────────────────────────────────

describe('Consumer — state', () => {
    it('id starts with "consumer-"', () => {
        const c = new Consumer('peer-2', 'video', 'prod-1')
        expect(c.id).toMatch(/^consumer-/)
    })

    it('producerId set from constructor', () => {
        const c = new Consumer('peer-2', 'video', 'prod-42')
        expect(c.producerId).toBe('prod-42')
    })

    it('close() is idempotent', () => {
        const c = new Consumer('peer-2', 'audio', 'prod-1')
        const fn = vi.fn()
        c.on(ConsumerEvent.Closed, fn)
        c.close()
        c.close()
        expect(fn).toHaveBeenCalledOnce()
    })
})

// ── MediaRouter ───────────────────────────────────────────────────────────────

describe('MediaRouter — producers', () => {
    let router: MediaRouter

    beforeEach(() => {
        router = new MediaRouter('room-1')
    })

    it('producerCount starts 0', () => {
        expect(router.producerCount).toBe(0)
    })

    it('createProducer returns Producer and increments count', () => {
        const p = router.createProducer('peer-1', 'audio')
        expect(p).toBeInstanceOf(Producer)
        expect(router.producerCount).toBe(1)
    })

    it('createProducer emits producerCreated', () => {
        const fn = vi.fn()
        router.on(MediaRouterEvent.ProducerCreated, fn)
        const p = router.createProducer('peer-1', 'video')
        expect(fn).toHaveBeenCalledWith(p)
    })

    it('createProducer throws when router is closed', () => {
        router.close()
        expect(() => router.createProducer('peer-1', 'audio')).toThrow('MediaRouter is closed')
    })
})

describe('MediaRouter — consumers', () => {
    let router: MediaRouter

    beforeEach(() => {
        router = new MediaRouter('room-1')
    })

    it('createConsumer returns Consumer with correct producerId', () => {
        const p = router.createProducer('peer-1', 'video')
        const c = router.createConsumer('peer-2', p.id)
        expect(c).toBeInstanceOf(Consumer)
        expect(c.producerId).toBe(p.id)
        expect(c.kind).toBe('video')
    })

    it('createConsumer emits consumerCreated', () => {
        const p = router.createProducer('peer-1', 'audio')
        const fn = vi.fn()
        router.on(MediaRouterEvent.ConsumerCreated, fn)
        const c = router.createConsumer('peer-2', p.id)
        expect(fn).toHaveBeenCalledWith(c)
    })

    it('createConsumer throws for unknown producerId', () => {
        expect(() => router.createConsumer('peer-2', 'ghost')).toThrow('Producer not found: ghost')
    })

    it('emits producerClosed when producer closes', () => {
        const p = router.createProducer('peer-1', 'audio')
        const fn = vi.fn()
        router.on(MediaRouterEvent.ProducerClosed, fn)
        p.close()
        expect(fn).toHaveBeenCalledWith(p)
    })

    it('closes consumers referencing a producer when it closes', () => {
        const p = router.createProducer('peer-1', 'audio')
        const c1 = router.createConsumer('peer-2', p.id)
        const c2 = router.createConsumer('peer-3', p.id)

        p.close()

        expect(c1.closed).toBe(true)
        expect(c2.closed).toBe(true)
        expect(router.consumerCount).toBe(0)
    })

    it('does not close consumers for a different producer', () => {
        const p1 = router.createProducer('peer-1', 'audio')
        const p2 = router.createProducer('peer-2', 'video')
        const c1 = router.createConsumer('peer-3', p1.id)
        const c2 = router.createConsumer('peer-3', p2.id)

        p1.close()

        expect(c1.closed).toBe(true)
        expect(c2.closed).toBe(false)
        expect(router.consumerCount).toBe(1)
    })
})

describe('MediaRouter — close', () => {
    it('close() cascades to all producers and consumers', () => {
        const router = new MediaRouter('room-1')
        const p = router.createProducer('peer-1', 'video')
        const c = router.createConsumer('peer-2', p.id)
        router.close()
        expect(p.closed).toBe(true)
        expect(c.closed).toBe(true)
    })

    it('close() emits closed', () => {
        const router = new MediaRouter('room-1')
        const fn = vi.fn()
        router.on(MediaRouterEvent.Closed, fn)
        router.close()
        expect(fn).toHaveBeenCalledOnce()
    })

    it('close() is idempotent', () => {
        const router = new MediaRouter('room-1')
        const fn = vi.fn()
        router.on(MediaRouterEvent.Closed, fn)
        router.close()
        router.close()
        expect(fn).toHaveBeenCalledOnce()
    })
})

describe('MediaRouter — closeProducersForPeer', () => {
    it('closes only producers belonging to the given peerId', () => {
        const router = new MediaRouter('room-1')
        const p1 = router.createProducer('peer-1', 'audio')
        const p2 = router.createProducer('peer-2', 'video')
        router.closeProducersForPeer('peer-1')
        expect(p1.closed).toBe(true)
        expect(p2.closed).toBe(false)
    })
})

// ── MediaService ──────────────────────────────────────────────────────────────

function makeRoom(id: string) {
    const _listeners = new Map<string, Array<(...args: unknown[]) => void>>()

    const on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        const arr = _listeners.get(event) ?? []
        arr.push(cb)
        _listeners.set(event, arr)
    })
    const off = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        const arr = _listeners.get(event)
        if (arr) {
            const idx = arr.indexOf(cb)
            if (idx !== -1) arr.splice(idx, 1)
        }
    })
    const once = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        const wrapped = (...args: unknown[]) => {
            off(event, wrapped)
            cb(...args)
        }
        on(event, wrapped)
    })

    const room = { id, on, off, once }

    const emit = (event: string, ...args: unknown[]) => {
        for (const cb of (_listeners.get(event) ?? []).slice()) cb(...args)
    }

    return {
        room: room as unknown as import('@rtcforge/signaling').Room,
        closeRoom: () => emit('closed'),
        simulatePeerLeft: (peerId: string) => emit('peerLeft', { id: peerId }),
    }
}

describe('MediaService — attachRoom', () => {
    let service: MediaService

    beforeEach(() => {
        service = new MediaService()
    })

    it('routerCount starts 0', () => {
        expect(service.routerCount).toBe(0)
    })

    it('attachRoom returns a MediaRouter', () => {
        const { room } = makeRoom('r1')
        expect(service.attachRoom(room)).toBeInstanceOf(MediaRouter)
    })

    it('attachRoom increments routerCount', () => {
        const { room } = makeRoom('r1')
        service.attachRoom(room)
        expect(service.routerCount).toBe(1)
    })

    it('attachRoom is idempotent — returns same router', () => {
        const { room } = makeRoom('r1')
        const r1 = service.attachRoom(room)
        const r2 = service.attachRoom(room)
        expect(r1).toBe(r2)
        expect(service.routerCount).toBe(1)
    })

    it('getRouter returns router by roomId', () => {
        const { room } = makeRoom('r1')
        const router = service.attachRoom(room)
        expect(service.getRouter('r1')).toBe(router)
    })

    it('getRouter returns undefined for unknown roomId', () => {
        expect(service.getRouter('ghost')).toBeUndefined()
    })

    it('router closes when room emits closed', () => {
        const { room, closeRoom } = makeRoom('r1')
        const router = service.attachRoom(room)
        closeRoom()
        expect(service.getRouter('r1')).toBeUndefined()
        expect(service.routerCount).toBe(0)
    })

    it('closeAll closes all routers and resets routerCount', () => {
        const { room: r1 } = makeRoom('r1')
        const { room: r2 } = makeRoom('r2')
        service.attachRoom(r1)
        service.attachRoom(r2)
        service.closeAll()
        expect(service.routerCount).toBe(0)
    })

    it('emits routerCreated when a room is attached', () => {
        const { room } = makeRoom('r1')
        const fn = vi.fn()
        service.on(MediaServiceEvent.RouterCreated, fn)
        const router = service.attachRoom(room)
        expect(fn).toHaveBeenCalledWith(router)
    })

    it('closes producers and consumers for a peer when they leave', () => {
        const { room, simulatePeerLeft } = makeRoom('r1')
        const router = service.attachRoom(room)
        const producer = router.createProducer('peer-1', 'audio')
        const consumer = router.createConsumer('peer-2', producer.id)

        simulatePeerLeft('peer-1')

        expect(producer.closed).toBe(true)
        expect(consumer.closed).toBe(true)
        expect(router.producerCount).toBe(0)
        expect(router.consumerCount).toBe(0)
    })

    it('closes subscriptions (consumers) when subscribing peer leaves', () => {
        const { room, simulatePeerLeft } = makeRoom('r1')
        const router = service.attachRoom(room)
        const producer = router.createProducer('peer-1', 'video')
        const consumer = router.createConsumer('peer-2', producer.id)

        simulatePeerLeft('peer-2')

        expect(consumer.closed).toBe(true)
        expect(producer.closed).toBe(false) // peer-1 still active
    })
})
