import { describe, expect, it, vi } from 'vitest'
import { ReferenceSfuMedia } from '../src/ReferenceSfuMedia.js'

describe('ReferenceSfuMedia', () => {
    it('tracks routes idempotently and drives the driver', () => {
        const onAddRoute = vi.fn()
        const media = new ReferenceSfuMedia({ onAddRoute })

        media.addRoute('r1', 'n1')
        media.addRoute('r1', 'n1') // duplicate — no double add or driver call
        media.addRoute('r1', 'n2')

        expect(media.getRoutes('r1').sort()).toEqual(['n1', 'n2'])
        expect(onAddRoute).toHaveBeenCalledTimes(2)
    })

    it('removeRoute clears the room and reports the removed nodes', () => {
        const onRemoveRoute = vi.fn()
        const media = new ReferenceSfuMedia({ onRemoveRoute })
        media.addRoute('r1', 'n1')
        media.addRoute('r1', 'n2')

        media.removeRoute('r1')

        expect(media.getRoutes('r1')).toEqual([])
        expect(onRemoveRoute).toHaveBeenCalledWith('r1', ['n1', 'n2'])
    })

    it('removeCascadeRoute removes only the named node', () => {
        const media = new ReferenceSfuMedia()
        media.addRoute('r1', 'n1')
        media.addRoute('r1', 'n2')

        media.removeCascadeRoute('r1', 'n1')

        expect(media.getRoutes('r1')).toEqual(['n2'])
    })

    it('tracks cascade links idempotently and drives pipe/unpipe', () => {
        const onPipeLink = vi.fn()
        const onUnpipeLink = vi.fn()
        const media = new ReferenceSfuMedia({ onPipeLink, onUnpipeLink })

        media.pipeLink('r1', 'a', 'b')
        media.pipeLink('r1', 'a', 'b') // duplicate
        expect(media.getLinks('r1')).toEqual(['a>b'])
        expect(onPipeLink).toHaveBeenCalledTimes(1)

        media.unpipeLink('r1', 'a', 'b')
        expect(media.getLinks('r1')).toEqual([])
        expect(onUnpipeLink).toHaveBeenCalledWith('r1', 'a', 'b')
    })

    it('reports async driver rejections through the logger without throwing', async () => {
        const error = vi.fn()
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error, fatal: vi.fn() }
        const media = new ReferenceSfuMedia(
            { onPipeLink: async () => Promise.reject(new Error('pipe blew up')) },
            logger,
        )

        media.pipeLink('r1', 'a', 'b') // must not throw
        await new Promise((r) => setTimeout(r, 0))

        expect(error).toHaveBeenCalledWith(
            'SfuMediaDriver hook failed',
            expect.objectContaining({ hook: 'onPipeLink' }),
        )
    })
})
