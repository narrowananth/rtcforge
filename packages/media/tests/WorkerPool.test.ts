import { EventEmitter } from 'rtcforge-core'
import type { Room } from 'rtcforge-signaling'
import { afterEach, describe, expect, it } from 'vitest'
import { MediaService } from '../src/MediaService.js'
import { WorkerPool } from '../src/WorkerPool.js'

class FakeRoom extends EventEmitter<Record<string, unknown[]>> {
    constructor(readonly id: string) {
        super()
    }
}
const asRoom = (r: FakeRoom): Room => r as unknown as Room

describe('WorkerPool (real workers)', () => {
    let pool: WorkerPool

    afterEach(async () => {
        await pool?.close()
    })

    it('start spawns the requested number of workers', async () => {
        pool = new WorkerPool({ numWorkers: 2 })
        await pool.start()
        expect(pool.size).toBe(2)
    })

    it('createRouter before start throws', async () => {
        pool = new WorkerPool({ numWorkers: 1 })
        await expect(pool.createRouter({ mediaCodecs: [] as never })).rejects.toThrow('not started')
    })

    it('creates real routers across the pool', async () => {
        pool = new WorkerPool({ numWorkers: 2 })
        await pool.start()
        const r1 = await pool.createRouter({
            mediaCodecs: [{ kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 }],
        })
        const r2 = await pool.createRouter({
            mediaCodecs: [{ kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 }],
        })
        expect(r1.id).not.toBe(r2.id)
        expect(r1.rtpCapabilities.codecs?.length).toBeGreaterThan(0)
        r1.close()
        r2.close()
    })

    it('start is idempotent', async () => {
        pool = new WorkerPool({ numWorkers: 1 })
        await pool.start()
        await pool.start()
        expect(pool.size).toBe(1)
    })
})

describe('MediaService (real workers)', () => {
    let service: MediaService

    afterEach(async () => {
        await service?.closeAll()
    })

    it('attachRoom before init throws', async () => {
        service = new MediaService({ worker: { numWorkers: 1 } })
        await expect(service.attachRoom(asRoom(new FakeRoom('r1')))).rejects.toThrow(
            'not initialized',
        )
    })

    it('init then attachRoom yields a router with real rtpCapabilities', async () => {
        service = new MediaService({ worker: { numWorkers: 1 } })
        await service.init()
        const router = await service.attachRoom(asRoom(new FakeRoom('r1')))
        const mimeTypes = router.rtpCapabilities.codecs?.map((c) => c.mimeType) ?? []
        expect(mimeTypes).toContain('audio/opus')
        expect(service.routerCount).toBe(1)
        expect(service.getRouter('r1')).toBe(router)
    })

    it('attachRoom is idempotent per room', async () => {
        service = new MediaService({ worker: { numWorkers: 1 } })
        await service.init()
        const room = asRoom(new FakeRoom('r1'))
        const a = await service.attachRoom(room)
        const b = await service.attachRoom(room)
        expect(a).toBe(b)
        expect(service.routerCount).toBe(1)
    })

    it('room close detaches and closes its router', async () => {
        service = new MediaService({ worker: { numWorkers: 1 } })
        await service.init()
        const room = new FakeRoom('r1')
        await service.attachRoom(asRoom(room))
        expect(service.routerCount).toBe(1)

        room.emit('closed')
        expect(service.routerCount).toBe(0)
    })

    it('init is idempotent', async () => {
        service = new MediaService({ worker: { numWorkers: 1 } })
        await service.init()
        await service.init()
        const router = await service.attachRoom(asRoom(new FakeRoom('r1')))
        expect(router).toBeDefined()
    })
})
