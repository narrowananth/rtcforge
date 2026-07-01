import { EventEmitter } from 'rtcforge-core'
import type { DataChannelHub } from '../../src/filetransfer/types.js'

type Listener = (ev: { data?: unknown }) => void

/** In-memory bidirectional stand-in for an RTCDataChannel. */
export class MockDataChannel {
    readyState: RTCDataChannelState = 'connecting'
    bufferedAmount = 0
    bufferedAmountLowThreshold = 0
    binaryType: 'blob' | 'arraybuffer' = 'blob'
    peer: MockDataChannel | null = null
    readonly sent: unknown[] = []
    private readonly _listeners = new Map<string, Set<Listener>>()

    constructor(readonly label: string) {}

    addEventListener(type: string, listener: Listener): void {
        let set = this._listeners.get(type)
        if (!set) {
            set = new Set()
            this._listeners.set(type, set)
        }
        set.add(listener)
    }

    removeEventListener(type: string, listener: Listener): void {
        this._listeners.get(type)?.delete(listener)
    }

    dispatch(type: string, ev: { data?: unknown } = {}): void {
        for (const l of [...(this._listeners.get(type) ?? [])]) l(ev)
    }

    send(data: unknown): void {
        if (this.readyState !== 'open') throw new Error(`send on ${this.readyState} channel`)
        this.sent.push(data)
        const peer = this.peer
        if (!peer) return
        queueMicrotask(() => {
            if (peer.readyState === 'open') peer.dispatch('message', { data })
        })
    }

    open(): void {
        this.readyState = 'open'
        this.dispatch('open')
    }

    close(): void {
        if (this.readyState === 'closed') return
        this.readyState = 'closed'
        this.dispatch('close')
    }

    asChannel(): RTCDataChannel {
        return this as unknown as RTCDataChannel
    }
}

/** Create a connected pair of mock channels; both open on the next microtask. */
export function makeChannelPair(label: string): [MockDataChannel, MockDataChannel] {
    const a = new MockDataChannel(label)
    const b = new MockDataChannel(label)
    a.peer = b
    b.peer = a
    queueMicrotask(() => {
        a.open()
        b.open()
    })
    return [a, b]
}

type HubEvents = { 'data-channel': [peerId: string, channel: RTCDataChannel] }

/** A {@link DataChannelHub} wired to a single remote peer for in-process tests. */
export class MockHub extends EventEmitter<HubEvents> implements DataChannelHub {
    remote!: MockHub
    connected = true
    /** All local channel ends we created, keyed by label. */
    readonly channels = new Map<string, MockDataChannel>()

    constructor(readonly selfId: string) {
        super()
    }

    static pair(idA = 'A', idB = 'B'): [MockHub, MockHub] {
        const a = new MockHub(idA)
        const b = new MockHub(idB)
        a.remote = b
        b.remote = a
        return [a, b]
    }

    createDataChannel(
        _peerId: string,
        label: string,
        _opts?: RTCDataChannelInit,
    ): RTCDataChannel | undefined {
        if (!this.connected) return undefined
        const [local, remote] = makeChannelPair(label)
        this.channels.set(label, local)
        queueMicrotask(() => this.remote.emit('data-channel', this.selfId, remote.asChannel()))
        return local.asChannel()
    }
}

/** Flush pending microtasks/timers so async chunk delivery settles. */
export async function flush(times = 50): Promise<void> {
    for (let i = 0; i < times; i += 1) await Promise.resolve()
}

/** Build a Blob from bytes (works around strict Uint8Array<ArrayBuffer> typing). */
export function toBlob(data: Uint8Array, type = 'text/plain'): Blob {
    return new Blob([data as unknown as BlobPart], { type })
}

/** Deterministic pseudo-random bytes for payload tests. */
export function randomBytes(n: number): Uint8Array {
    const out = new Uint8Array(n)
    let x = 0x9e3779b9 ^ n
    for (let i = 0; i < n; i += 1) {
        x = (x * 1664525 + 1013904223) >>> 0
        out[i] = x & 0xff
    }
    return out
}
