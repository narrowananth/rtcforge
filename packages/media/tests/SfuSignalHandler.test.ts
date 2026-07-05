import * as mediasoup from 'mediasoup'
import type { types as MsTypes } from 'mediasoup'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MediaRouter } from '../src/MediaRouter.js'
import { SfuSignalHandler } from '../src/SfuSignalHandler.js'
import { SfuMessageType } from '../src/sfuProtocol.js'
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

describe('SfuSignalHandler (real mediasoup worker)', () => {
    let worker: MsTypes.Worker
    let router: MediaRouter
    let sfu: SfuSignalHandler

    beforeAll(async () => {
        worker = await mediasoup.createWorker({ logLevel: 'error' })
    })
    afterAll(() => worker.close())

    beforeEach(async () => {
        const msRouter = await worker.createRouter({ mediaCodecs: DEFAULT_MEDIA_CODECS })
        router = new MediaRouter('room-1', msRouter)
        sfu = new SfuSignalHandler(router)
    })

    it('handles caps → create → connect → produce over the protocol', async () => {
        const caps = await sfu.handle('alice', { type: SfuMessageType.GetCapabilities })
        expect(caps.type).toBe('sfu-caps')

        const created = await sfu.handle('alice', {
            type: SfuMessageType.CreateTransport,
            direction: 'send',
        })
        expect(created.type).toBe('sfu-transport-created')
        const transportId = (created as { transport: { id: string } }).transport.id

        const produced = await sfu.handle('alice', {
            type: SfuMessageType.Produce,
            transportId,
            kind: 'audio',
            rtpParameters: OPUS_PRODUCE_PARAMS as unknown as Record<string, unknown>,
        })
        expect(produced.type).toBe('sfu-produced')
        expect(router.producerCount).toBe(1)
    })

    it('rejects a malformed request with sfu-error', async () => {
        const res = await sfu.handle('alice', { type: 'not-a-real-type', foo: 1 })
        expect(res).toEqual({ type: 'sfu-error', message: 'invalid SFU request' })
    })

    it('rejects produce on a recv-only transport', async () => {
        const created = await sfu.handle('alice', {
            type: SfuMessageType.CreateTransport,
            direction: 'recv',
        })
        const transportId = (created as { transport: { id: string } }).transport.id

        const res = await sfu.handle('alice', {
            type: SfuMessageType.Produce,
            transportId,
            kind: 'audio',
            rtpParameters: OPUS_PRODUCE_PARAMS as unknown as Record<string, unknown>,
        })
        expect(res.type).toBe('sfu-error')
        expect((res as { message: string }).message).toContain('recv-only')
        expect(router.producerCount).toBe(0)
    })

    it('replies sfu-error when resuming an unknown consumer', async () => {
        const res = await sfu.handle('alice', {
            type: SfuMessageType.ResumeConsumer,
            consumerId: 'does-not-exist',
        })
        expect(res.type).toBe('sfu-error')
        expect((res as { message: string }).message).toContain('Consumer not found')
    })

    it('enforces transport ownership across peers', async () => {
        const created = await sfu.handle('alice', {
            type: SfuMessageType.CreateTransport,
            direction: 'send',
        })
        const transportId = (created as { transport: { id: string } }).transport.id

        // bob tries to produce on alice's transport
        const res = await sfu.handle('bob', {
            type: SfuMessageType.Produce,
            transportId,
            kind: 'audio',
            rtpParameters: OPUS_PRODUCE_PARAMS as unknown as Record<string, unknown>,
        })
        expect(res.type).toBe('sfu-error')
        expect((res as { message: string }).message).toContain('does not belong to peer')
    })
})
