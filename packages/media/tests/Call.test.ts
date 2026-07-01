import { MessageType } from 'rtcforge-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Call } from '../src/Call.js'
import { SignalKind, SignalType } from '../src/protocol.js'
import { MediaEvent } from '../src/types.js'

function makeRoom(localPeerId = 'local', initialPeers: string[] = []) {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
    const peers = [localPeerId, ...initialPeers]

    const room = {
        localPeerId,
        peers,
        hasPeer: (id: string) => peers.includes(id),
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            listeners[event] = listeners[event] ?? []
            listeners[event].push(handler)
        }),
        off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler)
        }),
        sendSignal: vi.fn(),
        _emit: (event: string, ...args: unknown[]) => {
            for (const h of listeners[event] ?? []) h(...args)
        },
    }
    return room
}

function makeMockPC() {
    const mock = {
        signalingState: 'stable' as string,
        localDescription: { type: 'offer', sdp: 'mock-sdp' } as RTCSessionDescriptionInit,
        remoteDescription: null as RTCSessionDescriptionInit | null,
        onnegotiationneeded: null as ((...args: unknown[]) => void) | null,
        onicecandidate: null as ((...args: unknown[]) => void) | null,
        ontrack: null as ((...args: unknown[]) => void) | null,
        onconnectionstatechange: null as ((...args: unknown[]) => void) | null,
        addTrack: vi.fn().mockReturnValue({
            getParameters: vi.fn().mockReturnValue({ encodings: [{}] }),
            setParameters: vi.fn().mockResolvedValue(undefined),
        }),
        setLocalDescription: vi.fn().mockImplementation(async () => {
            mock.signalingState = 'have-local-offer'
        }),
        setRemoteDescription: vi
            .fn()
            .mockImplementation(async (desc: RTCSessionDescriptionInit) => {
                mock.remoteDescription = desc
                mock.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable'
                if (desc.type === 'offer') {
                    mock.localDescription = { type: 'answer', sdp: 'mock-answer-sdp' }
                }
            }),
        addIceCandidate: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
    }
    return mock
}

let mockPCInstance: ReturnType<typeof makeMockPC>

beforeEach(() => {
    mockPCInstance = makeMockPC()
    vi.stubGlobal('RTCPeerConnection', vi.fn().mockReturnValue(mockPCInstance))
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('Call — start', () => {
    it('creates connections for existing peers on start', () => {
        const room = makeRoom('local', ['remote1', 'remote2'])
        const call = new Call(room as never)
        call.start()

        expect(vi.mocked(RTCPeerConnection)).toHaveBeenCalledTimes(2)
    })

    it('does not create a connection to self', () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        call.start()

        expect(vi.mocked(RTCPeerConnection)).not.toHaveBeenCalled()
    })

    it('is idempotent — start() twice does not double-register listeners', () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        call.start()
        call.start()

        expect(room.on).toHaveBeenCalledTimes(4)
    })
})

describe('Call — peer lifecycle', () => {
    it('creates a connection when a new peer joins', () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        call.start()

        room._emit(MessageType.PeerJoined, 'remote-peer')

        expect(vi.mocked(RTCPeerConnection)).toHaveBeenCalledTimes(1)
    })

    it('emits RemoteStreamRemoved and closes connection when peer leaves', () => {
        const room = makeRoom('local', ['remote-peer'])
        const call = new Call(room as never)
        call.start()

        const handler = vi.fn()
        call.on(MediaEvent.RemoteStreamRemoved, handler)

        room._emit(MessageType.PeerLeft, 'remote-peer')

        expect(handler).toHaveBeenCalledWith('remote-peer')
        expect(mockPCInstance.close).toHaveBeenCalled()
    })
})

describe('Call — addTrack / subscribeAll', () => {
    it('adds track to all existing connections', () => {
        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never)
        call.start()

        const track = { stop: vi.fn() } as unknown as MediaStreamTrack
        const stream = {} as MediaStream
        call.addTrack(track, stream)

        expect(mockPCInstance.addTrack).toHaveBeenCalledWith(track, stream)
    })

    it('emits TrackPublished when a track is added', () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        call.start()

        const handler = vi.fn()
        call.on(MediaEvent.TrackPublished, handler)

        const track = { stop: vi.fn() } as unknown as MediaStreamTrack
        const stream = {} as MediaStream
        call.addTrack(track, stream)

        expect(handler).toHaveBeenCalledWith(track, stream)
    })
})

describe('Call — signal handling', () => {
    it('handles incoming Answer signal', async () => {
        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never)
        call.start()

        const answerSignal = { kind: SignalKind.Media, type: SignalType.Answer, sdp: 'answer-sdp' }
        await room._emit(MessageType.Signal, 'remote', answerSignal)

        expect(mockPCInstance.setRemoteDescription).toHaveBeenCalledWith({
            type: 'answer',
            sdp: 'answer-sdp',
        })
    })

    it('ignores non-media signals', async () => {
        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never)
        call.start()

        await room._emit(MessageType.Signal, 'remote', { kind: 'unknown', type: 'unknown' })

        expect(mockPCInstance.setRemoteDescription).not.toHaveBeenCalled()
    })

    it('emits Error and does not crash when signal handling rejects', async () => {
        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never)
        call.start()

        mockPCInstance.setRemoteDescription.mockRejectedValueOnce(new Error('bad SDP'))
        const errorHandler = vi.fn()
        call.on(MediaEvent.Error, errorHandler)

        const answerSignal = { kind: SignalKind.Media, type: SignalType.Answer, sdp: 'bad' }
        await room._emit(MessageType.Signal, 'remote', answerSignal)

        expect(errorHandler).toHaveBeenCalledWith('remote', expect.any(Error))
    })

    it('evicts broken PC on first signal failure so next signal gets fresh connection (V4)', async () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        call.start()

        room.peers.push('new-peer')

        room.sendSignal.mockImplementationOnce(() => {
            throw new Error('transport closed')
        })

        const errorHandler = vi.fn()
        call.on(MediaEvent.Error, errorHandler)

        room._emit(MessageType.Signal, 'new-peer', {
            kind: SignalKind.Media,
            type: SignalType.Offer,
            sdp: 'offer-sdp',
        })
        await new Promise((r) => setTimeout(r, 0))

        expect(errorHandler).toHaveBeenCalledTimes(1)

        expect(mockPCInstance.close).toHaveBeenCalledTimes(1)

        room.sendSignal.mockReset()
        room._emit(MessageType.Signal, 'new-peer', {
            kind: SignalKind.Media,
            type: SignalType.Offer,
            sdp: 'offer-2',
        })
        await new Promise((r) => setTimeout(r, 0))
        expect(vi.mocked(RTCPeerConnection)).toHaveBeenCalledTimes(2)
    })

    it('discards late signal from peer no longer in room', async () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        call.start()

        const iceSignal = {
            kind: SignalKind.Media,
            type: SignalType.Ice,
            candidate: { candidate: 'c' },
        }
        await room._emit(MessageType.Signal, 'ghost-peer', iceSignal)

        expect(vi.mocked(RTCPeerConnection)).not.toHaveBeenCalled()
    })

    it('handles ICE candidate signal', async () => {
        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never)
        call.start()

        const iceSignal = {
            kind: SignalKind.Media,
            type: SignalType.Ice,
            candidate: { candidate: 'cand', sdpMid: '0', sdpMLineIndex: 0 },
        }

        await room._emit(MessageType.Signal, 'remote', {
            kind: SignalKind.Media,
            type: SignalType.Answer,
            sdp: 'answer',
        })
        await room._emit(MessageType.Signal, 'remote', iceSignal)

        expect(mockPCInstance.addIceCandidate).toHaveBeenCalled()
    })
})

describe('Call — connection failure', () => {
    it('emits ConnectionFailed and evicts PC when state becomes failed', () => {
        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never)
        call.start()

        const failedHandler = vi.fn()
        call.on(MediaEvent.ConnectionFailed, failedHandler)
        ;(mockPCInstance as unknown as { connectionState: string }).connectionState = 'failed'
        mockPCInstance.onconnectionstatechange?.({} as never)

        expect(failedHandler).toHaveBeenCalledWith('remote')
        expect(mockPCInstance.close).toHaveBeenCalled()
    })
})

describe('Call — ConnectionEvent.Error evicts stale PC (Finding 2)', () => {
    it('evicts PC and emits Error when PeerConnection internal handleAnswer throws', async () => {
        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never)
        call.start()

        mockPCInstance.setRemoteDescription.mockRejectedValueOnce(new Error('ICE failure'))
        const errorHandler = vi.fn()
        call.on(MediaEvent.Error, errorHandler)

        room._emit(MessageType.Signal, 'remote', {
            kind: SignalKind.Media,
            type: SignalType.Answer,
            sdp: 'bad-sdp',
        })
        await new Promise((r) => setTimeout(r, 0))

        expect(errorHandler).toHaveBeenCalledWith('remote', expect.any(Error))
        expect(mockPCInstance.close).toHaveBeenCalled()
    })

    it('creates fresh connection after eviction so next signal succeeds (Finding 2)', async () => {
        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never)
        call.start()

        mockPCInstance.setRemoteDescription.mockRejectedValueOnce(new Error('ICE failure'))
        room._emit(MessageType.Signal, 'remote', {
            kind: SignalKind.Media,
            type: SignalType.Answer,
            sdp: 'bad',
        })
        await new Promise((r) => setTimeout(r, 0))

        room._emit(MessageType.Signal, 'remote', {
            kind: SignalKind.Media,
            type: SignalType.Answer,
            sdp: 'good',
        })
        await new Promise((r) => setTimeout(r, 0))

        expect(vi.mocked(RTCPeerConnection)).toHaveBeenCalledTimes(2)
    })
})

describe('Call — close', () => {
    it('removes room listeners on close', () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        call.start()
        call.close()

        expect(room.off).toHaveBeenCalledTimes(4)
    })

    it('close before start is a no-op', () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        expect(() => call.close()).not.toThrow()
    })
})

describe('Call — initial stream tracks', () => {
    it('adds initial stream tracks to new peer connections', () => {
        const track = { stop: vi.fn() } as unknown as MediaStreamTrack
        const stream = { getTracks: vi.fn().mockReturnValue([track]) } as unknown as MediaStream

        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never, { stream })
        call.start()

        expect(mockPCInstance.addTrack).toHaveBeenCalledWith(track, stream)
    })
})

describe('Call — mute/unmute', () => {
    function makeTrack(kind: 'audio' | 'video'): MediaStreamTrack {
        return { kind, enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack
    }

    it('muteAudio disables audio tracks', () => {
        const audio = makeTrack('audio')
        const video = makeTrack('video')
        const stream = {
            getTracks: vi.fn().mockReturnValue([audio, video]),
        } as unknown as MediaStream
        const room = makeRoom('local', [])
        const call = new Call(room as never, { stream })
        call.start()

        expect(call.isAudioMuted()).toBe(false)
        call.muteAudio()
        expect((audio as unknown as { enabled: boolean }).enabled).toBe(false)
        expect((video as unknown as { enabled: boolean }).enabled).toBe(true)
        expect(call.isAudioMuted()).toBe(true)
    })

    it('unmuteAudio re-enables audio tracks', () => {
        const audio = makeTrack('audio')
        const stream = {
            getTracks: vi.fn().mockReturnValue([audio]),
        } as unknown as MediaStream
        const room = makeRoom('local', [])
        const call = new Call(room as never, { stream })
        call.start()

        call.muteAudio()
        expect(call.isAudioMuted()).toBe(true)
        call.unmuteAudio()
        expect((audio as unknown as { enabled: boolean }).enabled).toBe(true)
        expect(call.isAudioMuted()).toBe(false)
    })

    it('muteVideo disables video tracks only', () => {
        const audio = makeTrack('audio')
        const video = makeTrack('video')
        const stream = {
            getTracks: vi.fn().mockReturnValue([audio, video]),
        } as unknown as MediaStream
        const room = makeRoom('local', [])
        const call = new Call(room as never, { stream })
        call.start()

        expect(call.isVideoMuted()).toBe(false)
        call.muteVideo()
        expect((video as unknown as { enabled: boolean }).enabled).toBe(false)
        expect((audio as unknown as { enabled: boolean }).enabled).toBe(true)
        expect(call.isVideoMuted()).toBe(true)
    })

    it('unmuteVideo re-enables video tracks', () => {
        const video = makeTrack('video')
        const stream = {
            getTracks: vi.fn().mockReturnValue([video]),
        } as unknown as MediaStream
        const room = makeRoom('local', [])
        const call = new Call(room as never, { stream })
        call.start()

        call.muteVideo()
        call.unmuteVideo()
        expect((video as unknown as { enabled: boolean }).enabled).toBe(true)
        expect(call.isVideoMuted()).toBe(false)
    })
})
