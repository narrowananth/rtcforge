import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingHandle } from '../src/RecordingHandle.js'
import { RecordingService } from '../src/RecordingService.js'
import { RecordingEvent, RecordingState } from '../src/types.js'

// ── MediaRecorder mock ────────────────────────────────────────────────────────

function makeMockMediaRecorder() {
    const mock = {
        mimeType: 'video/webm',
        state: 'recording' as string,
        ondataavailable: null as ((event: { data: { size: number } }) => void) | null,
        onstop: null as (() => void) | null,
        onerror: null as ((event: { error?: Error }) => void) | null,
        onpause: null as (() => void) | null,
        onresume: null as (() => void) | null,

        start: vi.fn(),
        stop: vi.fn().mockImplementation(() => {
            mock.onstop?.()
        }),
        pause: vi.fn().mockImplementation(() => {
            mock.state = 'paused'
            mock.onpause?.()
        }),
        resume: vi.fn().mockImplementation(() => {
            mock.state = 'recording'
            mock.onresume?.()
        }),
    }
    return mock
}

let mockMR: ReturnType<typeof makeMockMediaRecorder>
const fakeStream = { getTracks: () => [] } as unknown as MediaStream

beforeEach(() => {
    const MockMR = vi.fn().mockImplementation(() => {
        mockMR = makeMockMediaRecorder()
        return mockMR
    })
    ;(MockMR as unknown as { isTypeSupported: (m: string) => boolean }).isTypeSupported = vi
        .fn()
        .mockReturnValue(true)
    vi.stubGlobal('MediaRecorder', MockMR)
    vi.stubGlobal(
        'Blob',
        class MockBlob {
            size: number
            type: string
            constructor(parts: BlobPart[], opts?: { type?: string }) {
                this.type = opts?.type ?? ''
                this.size = (parts as unknown[]).reduce((acc: number, p) => {
                    if (typeof p === 'string') return acc + p.length
                    return (
                        acc +
                        (typeof (p as { size?: number }).size === 'number'
                            ? (p as { size: number }).size
                            : 0)
                    )
                }, 0)
            }
        },
    )
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.useRealTimers()
})

// ── RecordingHandle — lifecycle ───────────────────────────────────────────────

describe('RecordingHandle — lifecycle', () => {
    it('starts recording on construction', () => {
        new RecordingHandle(fakeStream)
        expect(mockMR.start).toHaveBeenCalledOnce()
    })

    it('starts with Recording state', () => {
        const handle = new RecordingHandle(fakeStream)
        expect(handle.state).toBe(RecordingState.Recording)
    })

    it('passes mimeType and per-track bitrates to MediaRecorder', () => {
        new RecordingHandle(fakeStream, {
            mimeType: 'video/mp4',
            videoBitsPerSecond: 2_500_000,
            audioBitsPerSecond: 128_000,
        })
        expect(vi.mocked(MediaRecorder)).toHaveBeenCalledWith(fakeStream, {
            mimeType: 'video/mp4',
            videoBitsPerSecond: 2_500_000,
            audioBitsPerSecond: 128_000,
        })
    })

    it('passes combined bitsPerSecond to MediaRecorder (audio-only / voice call)', () => {
        new RecordingHandle(fakeStream, { bitsPerSecond: 128_000 })
        expect(vi.mocked(MediaRecorder)).toHaveBeenCalledWith(fakeStream, {
            bitsPerSecond: 128_000,
        })
    })

    it('passes timeslice to start() (live stream chunked upload)', () => {
        new RecordingHandle(fakeStream, { timeslice: 1000 })
        expect(mockMR.start).toHaveBeenCalledWith(1000)
    })

    it('throws synchronously when mimeType is not supported', () => {
        ;(
            MediaRecorder as unknown as { isTypeSupported: ReturnType<typeof vi.fn> }
        ).isTypeSupported.mockReturnValue(false)
        expect(() => new RecordingHandle(fakeStream, { mimeType: 'video/mp4' })).toThrow(
            'MIME type not supported: video/mp4',
        )
    })

    it('does not check isTypeSupported when no mimeType given', () => {
        new RecordingHandle(fakeStream)
        expect(
            (MediaRecorder as unknown as { isTypeSupported: ReturnType<typeof vi.fn> })
                .isTypeSupported,
        ).not.toHaveBeenCalled()
    })
})

// ── RecordingHandle — data events ─────────────────────────────────────────────

describe('RecordingHandle — data events', () => {
    it('emits Data event when ondataavailable fires with non-empty chunk', () => {
        const handle = new RecordingHandle(fakeStream)
        const handler = vi.fn()
        handle.on(RecordingEvent.Data, handler)

        mockMR.ondataavailable?.({ data: { size: 512 } })

        expect(handler).toHaveBeenCalledOnce()
    })

    it('does not emit Data event for empty chunks', () => {
        const handle = new RecordingHandle(fakeStream)
        const handler = vi.fn()
        handle.on(RecordingEvent.Data, handler)

        mockMR.ondataavailable?.({ data: { size: 0 } })

        expect(handler).not.toHaveBeenCalled()
    })
})

// ── RecordingHandle — stop() ──────────────────────────────────────────────────

describe('RecordingHandle — stop()', () => {
    it('resolves with blob, duration, and mimeType on stop', async () => {
        const handle = new RecordingHandle(fakeStream)
        const result = await handle.stop()

        expect(result.mimeType).toBe('video/webm')
        expect(typeof result.duration).toBe('number')
        expect(result.duration).toBeGreaterThanOrEqual(0)
        expect(result.blob).toBeDefined()
    })

    it('emits Complete event on stop', async () => {
        const handle = new RecordingHandle(fakeStream)
        const handler = vi.fn()
        handle.on(RecordingEvent.Complete, handler)

        await handle.stop()

        expect(handler).toHaveBeenCalledOnce()
    })

    it('state is Stopped after stop()', async () => {
        const handle = new RecordingHandle(fakeStream)
        await handle.stop()
        expect(handle.state).toBe(RecordingState.Stopped)
    })

    it('rejects if already stopped', async () => {
        const handle = new RecordingHandle(fakeStream)
        await handle.stop()
        await expect(handle.stop()).rejects.toThrow('Recording already stopped')
    })

    it('calls underlying MediaRecorder.stop()', async () => {
        const handle = new RecordingHandle(fakeStream)
        await handle.stop()
        expect(mockMR.stop).toHaveBeenCalledOnce()
    })

    it('stop() while paused resolves correctly (paused video call then ended)', async () => {
        const handle = new RecordingHandle(fakeStream)
        handle.pause()
        expect(handle.state).toBe(RecordingState.Paused)

        const result = await handle.stop()

        expect(result.mimeType).toBe('video/webm')
        expect(handle.state).toBe(RecordingState.Stopped)
    })

    it('stop() resolving does not remove externally registered error listeners', async () => {
        const handle = new RecordingHandle(fakeStream)
        const externalErrorHandler = vi.fn()
        handle.on(RecordingEvent.Error, externalErrorHandler)

        await handle.stop()

        mockMR.onerror?.({ error: new Error('late error') })
        expect(externalErrorHandler).toHaveBeenCalledOnce()
    })
})

// ── RecordingHandle — pause/resume ────────────────────────────────────────────

describe('RecordingHandle — pause/resume', () => {
    it('pause() calls MediaRecorder.pause() and emits Pause event', () => {
        const handle = new RecordingHandle(fakeStream)
        const handler = vi.fn()
        handle.on(RecordingEvent.Pause, handler)

        handle.pause()

        expect(mockMR.pause).toHaveBeenCalledOnce()
        expect(handler).toHaveBeenCalledOnce()
    })

    it('state is Paused after pause()', () => {
        const handle = new RecordingHandle(fakeStream)
        handle.pause()
        expect(handle.state).toBe(RecordingState.Paused)
    })

    it('resume() calls MediaRecorder.resume() and emits Resume event', () => {
        const handle = new RecordingHandle(fakeStream)
        handle.pause()
        const handler = vi.fn()
        handle.on(RecordingEvent.Resume, handler)

        handle.resume()

        expect(mockMR.resume).toHaveBeenCalledOnce()
        expect(handler).toHaveBeenCalledOnce()
    })

    it('state is Recording after resume()', () => {
        const handle = new RecordingHandle(fakeStream)
        handle.pause()
        handle.resume()
        expect(handle.state).toBe(RecordingState.Recording)
    })

    it('pause() is a no-op when already paused', () => {
        const handle = new RecordingHandle(fakeStream)
        handle.pause()
        handle.pause()
        expect(mockMR.pause).toHaveBeenCalledOnce()
    })

    it('resume() is a no-op when already recording', () => {
        const handle = new RecordingHandle(fakeStream)
        handle.resume()
        expect(mockMR.resume).not.toHaveBeenCalled()
    })
})

// ── RecordingHandle — duration accuracy ───────────────────────────────────────

describe('RecordingHandle — duration accuracy', () => {
    it('duration excludes time spent paused', async () => {
        vi.useFakeTimers()

        const handle = new RecordingHandle(fakeStream)

        vi.advanceTimersByTime(5000) // 5s recording
        handle.pause()
        vi.advanceTimersByTime(3000) // 3s paused (should NOT count)
        handle.resume()
        vi.advanceTimersByTime(2000) // 2s more recording

        const result = await handle.stop()

        // Total wall time = 10s, paused = 3s → actual recording = 7s
        expect(result.duration).toBe(7000)
    })

    it('duration excludes paused time when stop() called while paused', async () => {
        vi.useFakeTimers()

        const handle = new RecordingHandle(fakeStream)

        vi.advanceTimersByTime(4000) // 4s recording
        handle.pause()
        vi.advanceTimersByTime(2000) // 2s paused then stopped

        const result = await handle.stop()

        // Wall time = 6s, paused = 2s → actual recording = 4s
        expect(result.duration).toBe(4000)
    })
})

// ── RecordingHandle — error ───────────────────────────────────────────────────

describe('RecordingHandle — error', () => {
    it('emits Error event when onerror fires', () => {
        const handle = new RecordingHandle(fakeStream)
        const handler = vi.fn()
        handle.on(RecordingEvent.Error, handler)

        const err = new Error('codec failure')
        mockMR.onerror?.({ error: err })

        expect(handler).toHaveBeenCalledWith(err)
    })

    it('stop() rejects when onerror fires before onstop', async () => {
        const handle = new RecordingHandle(fakeStream)
        mockMR.stop.mockImplementation(() => {
            mockMR.onerror?.({ error: new Error('mux failed') })
        })
        await expect(handle.stop()).rejects.toThrow('mux failed')
    })
})

// ── RecordingService ──────────────────────────────────────────────────────────

describe('RecordingService', () => {
    it('start() returns a RecordingHandle', () => {
        const svc = new RecordingService()
        const handle = svc.start(fakeStream)
        expect(handle).toBeInstanceOf(RecordingHandle)
    })

    it('activeCount increments on start', () => {
        const svc = new RecordingService()
        svc.start(fakeStream)
        svc.start(fakeStream)
        expect(svc.activeCount).toBe(2)
    })

    it('activeCount decrements after stop', async () => {
        const svc = new RecordingService()
        const handle = svc.start(fakeStream)
        await handle.stop()
        expect(svc.activeCount).toBe(0)
    })

    it('stopAll() stops all active recordings (multi-participant use case)', async () => {
        const svc = new RecordingService()
        svc.start(fakeStream)
        svc.start(fakeStream)

        await svc.stopAll()

        expect(svc.activeCount).toBe(0)
    })

    it('start() propagates service logger to handle when no per-recording logger given', () => {
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
        const svc = new RecordingService({ logger })
        svc.start(fakeStream)
        expect(logger.info).toHaveBeenCalledWith('Recording started', expect.any(Object))
    })

    it('isTypeSupported() delegates to MediaRecorder.isTypeSupported', () => {
        ;(
            MediaRecorder as unknown as { isTypeSupported: ReturnType<typeof vi.fn> }
        ).isTypeSupported.mockReturnValue(false)
        expect(RecordingService.isTypeSupported('video/mp4')).toBe(false)
    })

    it('getSupportedMimeTypes() returns only types where isTypeSupported is true', () => {
        const supported = new Set(['video/webm', 'audio/webm'])
        ;(
            MediaRecorder as unknown as { isTypeSupported: ReturnType<typeof vi.fn> }
        ).isTypeSupported.mockImplementation((t: string) => supported.has(t))

        const result = RecordingService.getSupportedMimeTypes()

        expect(result).toContain('video/webm')
        expect(result).toContain('audio/webm')
        expect(result).not.toContain('video/mp4')
        expect(result).not.toContain('audio/ogg')
    })
})

// ── RecordingHandle — mimeType getter ─────────────────────────────────────────

describe('RecordingHandle — mimeType getter', () => {
    it('returns the mimeType from the underlying MediaRecorder', () => {
        const handle = new RecordingHandle(fakeStream)
        expect(handle.mimeType).toBe('video/webm')
    })
})

// ── RecordingHandle — stream track ending ─────────────────────────────────────

function makeStreamWithTracks(count = 1) {
    const listeners: (() => void)[] = []
    const tracks = Array.from({ length: count }, () => ({
        addEventListener: (event: string, cb: () => void) => {
            if (event === 'ended') listeners.push(cb)
        },
        removeEventListener: (event: string, cb: () => void) => {
            if (event === 'ended') {
                const idx = listeners.indexOf(cb)
                if (idx !== -1) listeners.splice(idx, 1)
            }
        },
    }))
    const stream = { getTracks: () => tracks } as unknown as MediaStream
    // biome-ignore lint/complexity/noForEach: <explanation>
    const triggerTrackEnd = () => listeners.forEach((cb) => cb())
    return { stream, triggerTrackEnd }
}

describe('RecordingHandle — stream track ending', () => {
    it('auto-stops when a track ends (screen share stopped)', async () => {
        const { stream, triggerTrackEnd } = makeStreamWithTracks(1)
        const handle = new RecordingHandle(stream)

        triggerTrackEnd()

        expect(mockMR.stop).toHaveBeenCalledOnce()
    })

    it('emits Complete after track-end auto-stop', async () => {
        const { stream, triggerTrackEnd } = makeStreamWithTracks(1)
        const handle = new RecordingHandle(stream)
        const handler = vi.fn()
        handle.on(RecordingEvent.Complete, handler)

        triggerTrackEnd()

        expect(handler).toHaveBeenCalledOnce()
    })

    it('does not double-stop if already stopped when track ends', async () => {
        const { stream, triggerTrackEnd } = makeStreamWithTracks(1)
        const handle = new RecordingHandle(stream)
        await handle.stop()
        vi.clearAllMocks()

        triggerTrackEnd()

        expect(mockMR.stop).not.toHaveBeenCalled()
    })

    it('registers ended listener on every track in multi-track stream', async () => {
        const { stream, triggerTrackEnd } = makeStreamWithTracks(2)
        const handle = new RecordingHandle(stream)

        triggerTrackEnd() // both tracks fire ended

        // stop() called only once regardless of how many tracks ended
        expect(mockMR.stop).toHaveBeenCalledOnce()
    })
})
