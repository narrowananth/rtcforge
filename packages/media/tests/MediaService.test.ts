import * as mediasoup from 'mediasoup'
import type { types as MsTypes } from 'mediasoup'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaEntityEvent } from '../src/MediaEntity.js'
import { MediaRouter, MediaRouterEvent } from '../src/MediaRouter.js'
import { DEFAULT_MEDIA_CODECS } from '../src/types.js'

const OPUS_PRODUCE_PARAMS: MsTypes.RtpParameters = {
    codecs: [
        {
            mimeType: 'audio/opus',
            payloadType: 111,
            clockRate: 48000,
            channels: 2,
            parameters: { minptime: 10, useinbandfec: 1 },
            rtcpFeedback: [],
        },
    ],
    headerExtensions: [],
    encodings: [{ ssrc: 22222222 }],
    rtcp: { cname: 'rtcforge-test' },
}

describe('media plane (real mediasoup worker)', () => {
    let worker: MsTypes.Worker

    beforeAll(async () => {
        worker = await mediasoup.createWorker({ logLevel: 'error' })
    })

    afterAll(() => {
        worker.close()
    })

    async function makeRouter(): Promise<MediaRouter> {
        const msRouter = await worker.createRouter({ mediaCodecs: DEFAULT_MEDIA_CODECS })
        return new MediaRouter('room-1', msRouter)
    }

    async function produceWithRx(router: MediaRouter) {
        const tx = await router.createWebRtcTransport('alice')
        const rx = await router.createWebRtcTransport('bob')
        const producer = await router.produce('alice', tx.id, 'audio', OPUS_PRODUCE_PARAMS)
        return { producer, rxId: rx.id }
    }

    describe('MediaRouter — router', () => {
        let router: MediaRouter
        beforeEach(async () => {
            router = await makeRouter()
        })

        it('exposes real router rtpCapabilities (opus + VP8)', () => {
            const mimeTypes = router.rtpCapabilities.codecs?.map((c) => c.mimeType) ?? []
            expect(mimeTypes).toContain('audio/opus')
            expect(mimeTypes).toContain('video/VP8')
        })

        it('createWebRtcTransport returns real ICE/DTLS params', async () => {
            const params = await router.createWebRtcTransport('alice')
            expect(typeof params.id).toBe('string')
            expect(params.iceCandidates.length).toBeGreaterThan(0)
            expect(params.dtlsParameters.fingerprints.length).toBeGreaterThan(0)
            expect(['auto', 'client', 'server']).toContain(params.dtlsParameters.role)
        })

        it('connectTransport throws for unknown transport', async () => {
            await expect(
                router.connectTransport('alice', 'ghost', {} as MsTypes.DtlsParameters),
            ).rejects.toThrow('Transport not found')
        })

        it('produce throws for unknown transport', async () => {
            await expect(
                router.produce('alice', 'ghost', 'audio', OPUS_PRODUCE_PARAMS),
            ).rejects.toThrow('Transport not found')
        })
    })

    describe('MediaRouter — produce / consume', () => {
        let router: MediaRouter
        beforeEach(async () => {
            router = await makeRouter()
        })

        it('produces a track and emits producerAdded', async () => {
            const t = await router.createWebRtcTransport('alice')
            const onAdded = vi.fn()
            router.on(MediaRouterEvent.ProducerAdded, onAdded)

            const producer = await router.produce('alice', t.id, 'audio', OPUS_PRODUCE_PARAMS)

            expect(producer.kind).toBe('audio')
            expect(producer.peerId).toBe('alice')
            expect(producer.role).toBe('producer')
            expect(router.producerCount).toBe(1)
            expect(onAdded).toHaveBeenCalledWith(producer)
        })

        it('consumes an existing producer (paused) and emits consumerAdded', async () => {
            const { producer, rxId } = await produceWithRx(router)

            const onAdded = vi.fn()
            router.on(MediaRouterEvent.ConsumerAdded, onAdded)
            const consumer = await router.consume('bob', rxId, producer.id, router.rtpCapabilities)

            expect(consumer.role).toBe('consumer')
            expect(consumer.producerId).toBe(producer.id)
            expect(consumer.kind).toBe('audio')
            expect(consumer.paused).toBe(true)
            expect(consumer.rtpParameters.codecs[0]?.mimeType).toBe('audio/opus')
            expect(router.consumerCount).toBe(1)
            expect(onAdded).toHaveBeenCalledWith(consumer)
        })

        it('consume throws for unknown producer', async () => {
            const rx = await router.createWebRtcTransport('bob')
            await expect(
                router.consume('bob', rx.id, 'ghost-producer', router.rtpCapabilities),
            ).rejects.toThrow('Producer not found')
        })

        it('resumeConsumer unpauses', async () => {
            const { producer, rxId } = await produceWithRx(router)
            const consumer = await router.consume('bob', rxId, producer.id, router.rtpCapabilities)

            await router.resumeConsumer('bob', consumer.id)
            expect(consumer.paused).toBe(false)
        })

        it('resumeConsumer rejects a peer that does not own the consumer', async () => {
            const { producer, rxId } = await produceWithRx(router)
            const consumer = await router.consume('bob', rxId, producer.id, router.rtpCapabilities)
            await expect(router.resumeConsumer('mallory', consumer.id)).rejects.toThrow(
                /does not belong to peer/,
            )
            expect(consumer.paused).toBe(true) // untouched
        })

        it('closing a producer closes its consumers and emits producerClosed', async () => {
            const { producer, rxId } = await produceWithRx(router)
            const consumer = await router.consume('bob', rxId, producer.id, router.rtpCapabilities)

            const onClosed = vi.fn()
            router.on(MediaRouterEvent.ProducerClosed, onClosed)
            producer.close()

            expect(producer.closed).toBe(true)
            expect(router.producerCount).toBe(0)
            expect(onClosed).toHaveBeenCalledWith(producer)

            await vi.waitFor(() => expect(consumer.closed).toBe(true))
            expect(router.consumerCount).toBe(0)
        })

        it('closing a peer transport drops its producers', async () => {
            const tx = await router.createWebRtcTransport('alice')
            await router.produce('alice', tx.id, 'audio', OPUS_PRODUCE_PARAMS)
            expect(router.producerCount).toBe(1)

            router.closeTransportsForPeer('alice')
            await Promise.resolve()
            expect(router.producerCount).toBe(0)
        })
    })

    describe('MediaEntity lifecycle', () => {
        let router: MediaRouter
        beforeEach(async () => {
            router = await makeRouter()
        })

        it('pause/resume delegate to mediasoup and emit', async () => {
            const t = await router.createWebRtcTransport('alice')
            const producer = await router.produce('alice', t.id, 'audio', OPUS_PRODUCE_PARAMS)
            const onPaused = vi.fn()
            const onResumed = vi.fn()
            producer.on(MediaEntityEvent.Paused, onPaused)
            producer.on(MediaEntityEvent.Resumed, onResumed)

            await producer.pause()
            expect(producer.paused).toBe(true)
            expect(onPaused).toHaveBeenCalledOnce()

            await producer.resume()
            expect(producer.paused).toBe(false)
            expect(onResumed).toHaveBeenCalledOnce()
        })

        it('close emits closed once (idempotent)', async () => {
            const t = await router.createWebRtcTransport('alice')
            const producer = await router.produce('alice', t.id, 'audio', OPUS_PRODUCE_PARAMS)
            const onClosed = vi.fn()
            producer.on(MediaEntityEvent.Closed, onClosed)
            producer.close()
            producer.close()
            expect(onClosed).toHaveBeenCalledOnce()
        })
    })

    describe('cross-node media bridging', () => {
        let workerA: MsTypes.Worker
        let workerB: MsTypes.Worker

        beforeAll(async () => {
            workerA = await mediasoup.createWorker({ logLevel: 'error' })
            workerB = await mediasoup.createWorker({ logLevel: 'error' })
        })
        afterAll(() => {
            workerA.close()
            workerB.close()
        })

        async function routerOn(w: MsTypes.Worker): Promise<MediaRouter> {
            const msRouter = await w.createRouter({ mediaCodecs: DEFAULT_MEDIA_CODECS })
            return new MediaRouter('room', msRouter)
        }
        async function produceOn(router: MediaRouter) {
            const tx = await router.createWebRtcTransport('alice')
            return router.produce('alice', tx.id, 'audio', OPUS_PRODUCE_PARAMS)
        }

        it('pipeProducerTo bridges a producer to another router', async () => {
            const a = await routerOn(workerA)
            const b = await routerOn(workerB)
            const producer = await produceOn(a)

            await a.pipeProducerTo(producer.id, b)

            expect(b.producerCount).toBe(1)
            const rx = await b.createWebRtcTransport('bob')
            const consumer = await b.consume('bob', rx.id, producer.id, b.rtpCapabilities)
            expect(consumer.producerId).toBe(producer.id)
        })

        it('pipeProducerTo is idempotent', async () => {
            const a = await routerOn(workerA)
            const b = await routerOn(workerB)
            const producer = await produceOn(a)
            await a.pipeProducerTo(producer.id, b)
            await a.pipeProducerTo(producer.id, b)
            expect(b.producerCount).toBe(1)
        })

        it('bridges via PipeTransport (cross-host engine, loopback)', async () => {
            const a = await routerOn(workerA)
            const b = await routerOn(workerB)
            const producer = await produceOn(a)

            const pa = await a.createPipeTransport()
            const pb = await b.createPipeTransport()
            await a.connectPipeTransport(pa.id, pb)
            await b.connectPipeTransport(pb.id, pa)

            const params = await a.pipeConsume(pa.id, producer.id)
            await b.pipeProduce(pb.id, params)

            expect(b.producerCount).toBe(1)
            const rx = await b.createWebRtcTransport('bob')
            const consumer = await b.consume('bob', rx.id, producer.id, b.rtpCapabilities)
            expect(consumer.producerId).toBe(producer.id)
        })
    })
})
