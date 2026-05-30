import { randomUUID } from 'node:crypto'
import { EventEmitter } from '@rtcforge/core'

export const MediaEntityEvent = {
    Closed: 'closed',
    Paused: 'paused',
    Resumed: 'resumed',
} as const

export type MediaEntityEvent = (typeof MediaEntityEvent)[keyof typeof MediaEntityEvent]

type MediaEntityEvents = {
    [MediaEntityEvent.Closed]: []
    [MediaEntityEvent.Paused]: []
    [MediaEntityEvent.Resumed]: []
}

export abstract class MediaEntity extends EventEmitter<MediaEntityEvents> {
    readonly id: string
    readonly peerId: string
    readonly kind: 'audio' | 'video'
    protected _paused = false
    protected _closed = false

    constructor(idPrefix: string, peerId: string, kind: 'audio' | 'video') {
        super()
        this.id = `${idPrefix}-${randomUUID()}`
        this.peerId = peerId
        this.kind = kind
    }

    get paused(): boolean {
        return this._paused
    }
    get closed(): boolean {
        return this._closed
    }

    pause(): void {
        if (this._closed || this._paused) return
        this._paused = true
        this.emit(MediaEntityEvent.Paused)
    }

    resume(): void {
        if (this._closed || !this._paused) return
        this._paused = false
        this.emit(MediaEntityEvent.Resumed)
    }

    close(): void {
        if (this._closed) return
        this._closed = true
        this.emit(MediaEntityEvent.Closed)
    }
}
