import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDisplayMedia, getUserMedia } from '../src/MediaManager.js'

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('getUserMedia', () => {
    it('delegates to navigator.mediaDevices.getUserMedia with provided constraints', async () => {
        const mockStream = {} as MediaStream
        const mock = vi.fn().mockResolvedValue(mockStream)
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: mock } })

        const stream = await getUserMedia({ video: true, audio: false })

        expect(stream).toBe(mockStream)
        expect(mock).toHaveBeenCalledWith({ video: true, audio: false })
    })

    it('uses { video: true, audio: true } as default constraints', async () => {
        const mock = vi.fn().mockResolvedValue({} as MediaStream)
        vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: mock } })

        await getUserMedia()

        expect(mock).toHaveBeenCalledWith({ video: true, audio: true })
    })

    it('rejects when getUserMedia rejects', async () => {
        const err = new DOMException('Permission denied', 'NotAllowedError')
        vi.stubGlobal('navigator', {
            mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(err) },
        })

        await expect(getUserMedia()).rejects.toThrow('Permission denied')
    })
})

describe('getDisplayMedia', () => {
    it('delegates to navigator.mediaDevices.getDisplayMedia with provided constraints', async () => {
        const mockStream = {} as MediaStream
        const mock = vi.fn().mockResolvedValue(mockStream)
        vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: mock } })

        const stream = await getDisplayMedia({ video: true })

        expect(stream).toBe(mockStream)
        expect(mock).toHaveBeenCalledWith({ video: true })
    })

    it('uses empty object as default constraints', async () => {
        const mock = vi.fn().mockResolvedValue({} as MediaStream)
        vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: mock } })

        await getDisplayMedia()

        expect(mock).toHaveBeenCalledWith({})
    })
})
