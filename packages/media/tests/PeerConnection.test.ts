import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerConnection } from '../src/PeerConnection.js'
import { ConnectionEvent } from '../src/types.js'

type EventHandler = (...args: unknown[]) => void

function makeMockRTCPeerConnection() {
    const pending: RTCIceCandidateInit[] = []
    let remoteDesc: RTCSessionDescriptionInit | null = null
    let localDesc: RTCSessionDescriptionInit | null = null
    let signalingState = 'stable'

    const mock = {
        signalingState: 'stable' as string,
        connectionState: 'new' as RTCPeerConnectionState,
        localDescription: null as RTCSessionDescriptionInit | null,
        remoteDescription: null as RTCSessionDescriptionInit | null,

        onnegotiationneeded: null as EventHandler | null,
        onicecandidate: null as EventHandler | null,
        ontrack: null as EventHandler | null,
        onconnectionstatechange: null as EventHandler | null,

        addTrack: vi.fn().mockReturnValue({
            getParameters: vi.fn().mockReturnValue({ encodings: [{}] }),
            setParameters: vi.fn().mockResolvedValue(undefined),
        }),

        setLocalDescription: vi
            .fn()
            .mockImplementation(async (desc?: RTCSessionDescriptionInit) => {
                localDesc = desc ?? { type: 'offer', sdp: 'mock-offer-sdp' }
                mock.localDescription = localDesc
                signalingState = localDesc.type === 'offer' ? 'have-local-offer' : 'stable'
                mock.signalingState = signalingState
            }),

        setRemoteDescription: vi
            .fn()
            .mockImplementation(async (desc: RTCSessionDescriptionInit) => {
                remoteDesc = desc
                mock.remoteDescription = remoteDesc
                signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable'
                mock.signalingState = signalingState
            }),

        addIceCandidate: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
    }

    return mock
}

let mockPC: ReturnType<typeof makeMockRTCPeerConnection>

beforeEach(() => {
    mockPC = makeMockRTCPeerConnection()
    vi.stubGlobal('RTCPeerConnection', vi.fn().mockReturnValue(mockPC))
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

describe('PeerConnection — ICE candidate buffering', () => {
    it('buffers ICE candidates received before remote description is set', async () => {
        const pc = new PeerConnection(true)
        const candidate = { candidate: 'mock', sdpMid: '0', sdpMLineIndex: 0 }

        await pc.addIceCandidate(candidate)

        expect(mockPC.addIceCandidate).not.toHaveBeenCalled()
    })

    it('drains buffered candidates after handleAnswer sets remote description', async () => {
        const pc = new PeerConnection(false)
        const candidate = { candidate: 'mock', sdpMid: '0', sdpMLineIndex: 0 }

        await pc.addIceCandidate(candidate)
        await pc.handleAnswer('mock-answer-sdp')

        expect(mockPC.addIceCandidate).toHaveBeenCalledWith(candidate)
    })

    it('ignores null end-of-candidates marker when no remote description', async () => {
        const pc = new PeerConnection(true)
        await expect(pc.addIceCandidate(null)).resolves.toBeUndefined()
        expect(mockPC.addIceCandidate).not.toHaveBeenCalled()
    })
})

describe('PeerConnection — handleOffer / handleAnswer', () => {
    it('handleOffer sets remote description and returns an answer', async () => {
        mockPC.setLocalDescription.mockImplementationOnce(async () => {
            mockPC.localDescription = { type: 'answer', sdp: 'mock-answer-sdp' }
        })

        const pc = new PeerConnection(true)
        const answer = await pc.handleOffer('mock-offer-sdp')

        expect(mockPC.setRemoteDescription).toHaveBeenCalledWith({
            type: 'offer',
            sdp: 'mock-offer-sdp',
        })
        expect(answer?.type).toBe('answer')
    })

    it('handleAnswer sets remote description', async () => {
        const pc = new PeerConnection(false)
        await pc.handleAnswer('mock-answer-sdp')

        expect(mockPC.setRemoteDescription).toHaveBeenCalledWith({
            type: 'answer',
            sdp: 'mock-answer-sdp',
        })
    })

    it('impolite peer returns null on offer collision', async () => {
        mockPC.signalingState = 'have-local-offer'

        const pc = new PeerConnection(false)

        const result = await pc.handleOffer('collision-offer')

        expect(result).toBeNull()
        expect(mockPC.setRemoteDescription).not.toHaveBeenCalled()
    })
})

describe('PeerConnection — events', () => {
    it('emits IceCandidate when pc.onicecandidate fires', () => {
        const pc = new PeerConnection(true)
        const handler = vi.fn()
        pc.on(ConnectionEvent.IceCandidate, handler)

        const candidate = { candidate: 'ice-cand', sdpMid: '0', sdpMLineIndex: 0 }
        mockPC.onicecandidate?.({ candidate: { toJSON: () => candidate } })

        expect(handler).toHaveBeenCalledWith(candidate)
    })

    it('emits Track when pc.ontrack fires', () => {
        const pc = new PeerConnection(true)
        const handler = vi.fn()
        pc.on(ConnectionEvent.Track, handler)

        const track = {} as MediaStreamTrack
        const streams = [{}] as unknown as MediaStream[]
        mockPC.ontrack?.({ track, streams })

        expect(handler).toHaveBeenCalledWith(track, streams)
    })

    it('emits StateChange when connection state changes', () => {
        const pc = new PeerConnection(true)
        const handler = vi.fn()
        pc.on(ConnectionEvent.StateChange, handler)

        mockPC.connectionState = 'connected'
        mockPC.onconnectionstatechange?.()

        expect(handler).toHaveBeenCalledWith('connected')
    })
})

describe('PeerConnection — addTrack', () => {
    it('adds track to underlying peer connection', () => {
        const pc = new PeerConnection(true)
        const track = {} as MediaStreamTrack
        const stream = {} as MediaStream
        pc.addTrack(track, stream)
        expect(mockPC.addTrack).toHaveBeenCalledWith(track, stream)
    })
})

describe('PeerConnection — ICE server config', () => {
    it('uses no ICE servers by default', () => {
        new PeerConnection(true)
        const config = vi.mocked(RTCPeerConnection).mock.calls[0]?.[0] as RTCConfiguration
        expect(config.iceServers).toEqual([])
    })

    it('passes provided iceServers to RTCPeerConnection', () => {
        const stun = { urls: 'stun:stun.example.com' }
        const turn = { urls: 'turn:turn.example.com', username: 'u', credential: 'p' }
        new PeerConnection(true, { iceServers: [stun, turn] })
        const config = vi.mocked(RTCPeerConnection).mock.calls[0]?.[0] as RTCConfiguration
        expect(config.iceServers).toEqual([stun, turn])
    })

    it('supports an array of multiple iceServers', () => {
        const servers = [
            { urls: 'stun:s1.example.com' },
            { urls: 'turn:t1.example.com' },
            { urls: 'turn:t2.example.com' },
        ]
        new PeerConnection(true, { iceServers: servers })
        const config = vi.mocked(RTCPeerConnection).mock.calls[0]?.[0] as RTCConfiguration
        expect(config.iceServers?.length).toBe(3)
    })
})
