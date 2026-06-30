import { EventEmitter } from 'rtcforge-core'
import type { MediaKind } from 'rtcforge-core'

export interface MediaEntityHandle {
    readonly id: string
    readonly kind: MediaKind
    readonly paused: boolean
    readonly closed: boolean
    pause(): Promise<void>
    resume(): Promise<void>
    close(): void
    on(event: 'transportclose', listener: () => void): unknown
}

export const MediaEntityEvent = {
    Closed: 'closed',
    Paused: 'paused',
    Resumed: 'resumed',
} as const

export type MediaEntityEvent = (typeof MediaEntityEvent)[keyof typeof MediaEntityEvent]

export type MediaEntityRole = 'producer' | 'consumer'

type MediaEntityEvents = {
    [MediaEntityEvent.Closed]: []
    [MediaEntityEvent.Paused]: []
    [MediaEntityEvent.Resumed]: []
}

export abstract class MediaEntity extends EventEmitter<MediaEntityEvents> {
    abstract readonly role: MediaEntityRole
    readonly peerId: string
    protected readonly _entity: MediaEntityHandle
    private _closeEmitted = false

    constructor(peerId: string, entity: MediaEntityHandle) {
        super()
        this.peerId = peerId
        this._entity = entity
        entity.on('transportclose', () => this._emitClosed())
    }

    get id(): string {
        return this._entity.id
    }

    get kind(): MediaKind {
        return this._entity.kind
    }

    get paused(): boolean {
        return this._entity.paused
    }

    get closed(): boolean {
        return this._entity.closed
    }

    async pause(): Promise<void> {
        if (this._entity.closed || this._entity.paused) return
        await this._entity.pause()
        this.emit(MediaEntityEvent.Paused)
    }

    async resume(): Promise<void> {
        if (this._entity.closed || !this._entity.paused) return
        await this._entity.resume()
        this.emit(MediaEntityEvent.Resumed)
    }

    close(): void {
        if (this._entity.closed) {
            this._emitClosed()
            return
        }
        this._entity.close()
        this._emitClosed()
    }

    private _emitClosed(): void {
        if (this._closeEmitted) return
        this._closeEmitted = true
        this.emit(MediaEntityEvent.Closed)
    }
}
