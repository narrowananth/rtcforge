import { MessageType } from '@rtcforge/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Call } from '../src/Call.js'
import { SignalKind, SignalType } from '../src/protocol.js'
import { MediaEvent } from '../src/types.js'

// ── Minimal Room mock ─────────────────────────────────────────────────────────

function makeRoom(localPeerId = 'local', initialPeers: string[] = []) {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}

    const room = {
        localPeerId,
        peers: [localPeerId, ...initialPeers],
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

// ── RTCPeerConnection mock ────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

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

        expect(room.on).toHaveBeenCalledTimes(3) // PeerJoined, PeerLeft, Signal
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

        const track = {} as MediaStreamTrack
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

        const track = {} as MediaStreamTrack
        const stream = {} as MediaStream
        call.addTrack(track, stream)

        expect(handler).toHaveBeenCalledWith(track, stream)
    })

    it('subscribeAll is a no-op in mesh mode', () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        call.start()
        expect(() => call.subscribeAll()).not.toThrow()
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

    it('handles ICE candidate signal', async () => {
        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never)
        call.start()

        const iceSignal = {
            kind: SignalKind.Media,
            type: SignalType.Ice,
            candidate: { candidate: 'cand', sdpMid: '0', sdpMLineIndex: 0 },
        }
        // handleAnswer first so remoteDescription is set
        await room._emit(MessageType.Signal, 'remote', {
            kind: SignalKind.Media,
            type: SignalType.Answer,
            sdp: 'answer',
        })
        await room._emit(MessageType.Signal, 'remote', iceSignal)

        expect(mockPCInstance.addIceCandidate).toHaveBeenCalled()
    })
})

describe('Call — close', () => {
    it('removes room listeners on close', () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        call.start()
        call.close()

        expect(room.off).toHaveBeenCalledTimes(3)
    })

    it('close before start is a no-op', () => {
        const room = makeRoom('local', [])
        const call = new Call(room as never)
        expect(() => call.close()).not.toThrow()
    })
})

describe('Call — initial stream tracks', () => {
    it('adds initial stream tracks to new peer connections', () => {
        const track = {} as MediaStreamTrack
        const stream = { getTracks: vi.fn().mockReturnValue([track]) } as unknown as MediaStream

        const room = makeRoom('local', ['remote'])
        const call = new Call(room as never, { stream })
        call.start()

        expect(mockPCInstance.addTrack).toHaveBeenCalledWith(track, stream)
    })
})
