import type { ControlMessage } from './protocol.js'

export class ControlLink {
    // Cap the pre-open backlog so a channel that never opens can't grow the queue
    // without bound. Control messages are small and few; this is generous headroom.
    private static readonly MAX_QUEUE = 1024

    private readonly _channel: RTCDataChannel
    private _queue: string[] = []

    constructor(channel: RTCDataChannel, onMessage: (raw: unknown) => void) {
        this._channel = channel
        channel.addEventListener('message', (ev: MessageEvent) => onMessage(ev.data))
        if (channel.readyState === 'open') this._flush()
        else channel.addEventListener('open', () => this._flush())
    }

    get isOpen(): boolean {
        return this._channel.readyState === 'open'
    }

    send(msg: ControlMessage): void {
        const raw = JSON.stringify(msg)
        if (this._channel.readyState === 'open') {
            this._channel.send(raw)
            return
        }
        // Drop the oldest queued message when the backlog is full rather than growing
        // unbounded on a channel that never opens.
        if (this._queue.length >= ControlLink.MAX_QUEUE) this._queue.shift()
        this._queue.push(raw)
    }

    close(): void {
        try {
            this._channel.close()
        } catch {}
    }

    private _flush(): void {
        const pending = this._queue
        this._queue = []
        for (const raw of pending) this._channel.send(raw)
    }
}
