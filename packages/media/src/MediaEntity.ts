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

/**
 * Lifecycle events emitted by a {@link MediaEntity} ({@link Producer} or {@link Consumer}).
 */
export const MediaEntityEvent = {
    /** The entity was closed, either directly or because its transport closed. Emitted at most once. */
    Closed: 'closed',
    /** The entity was paused. */
    Paused: 'paused',
    /** The entity was resumed. */
    Resumed: 'resumed',
} as const

/** Union of the string values in {@link MediaEntityEvent}. */
export type MediaEntityEvent = (typeof MediaEntityEvent)[keyof typeof MediaEntityEvent]

/** Whether a {@link MediaEntity} sends media (`"producer"`) or receives it (`"consumer"`). */
export type MediaEntityRole = 'producer' | 'consumer'

type MediaEntityEvents = {
    [MediaEntityEvent.Closed]: []
    [MediaEntityEvent.Paused]: []
    [MediaEntityEvent.Resumed]: []
}

/**
 * Server-side (mediasoup SFU) base class shared by {@link Producer} and
 * {@link Consumer}. Wraps a mediasoup entity, forwards its `transportclose` to a
 * {@link MediaEntityEvent.Closed} event (emitted at most once), and guards pause/
 * resume/close so they are idempotent.
 */
export abstract class MediaEntity extends EventEmitter<MediaEntityEvents> {
    /** Whether this entity produces or consumes media. */
    abstract readonly role: MediaEntityRole
    /** Id of the peer this entity belongs to. */
    readonly peerId: string
    /** The wrapped mediasoup producer/consumer handle. */
    protected readonly _entity: MediaEntityHandle
    private _closeEmitted = false

    /**
     * @param peerId - Id of the owning peer.
     * @param entity - The underlying mediasoup producer/consumer handle to wrap.
     */
    constructor(peerId: string, entity: MediaEntityHandle) {
        super()
        this.peerId = peerId
        this._entity = entity
        entity.on('transportclose', () => this._emitClosed())
    }

    /** The underlying entity's id. */
    get id(): string {
        return this._entity.id
    }

    /** The media kind (`"audio"` or `"video"`). */
    get kind(): MediaKind {
        return this._entity.kind
    }

    /** Whether the entity is currently paused. */
    get paused(): boolean {
        return this._entity.paused
    }

    /** Whether the entity has been closed. */
    get closed(): boolean {
        return this._entity.closed
    }

    /**
     * Pauses the entity. No-op if already closed or paused.
     *
     * @remarks Emits {@link MediaEntityEvent.Paused} when a pause actually occurs.
     */
    async pause(): Promise<void> {
        if (this._entity.closed || this._entity.paused) return
        await this._entity.pause()
        this.emit(MediaEntityEvent.Paused)
    }

    /**
     * Resumes the entity. No-op if closed or not paused.
     *
     * @remarks Emits {@link MediaEntityEvent.Resumed} when a resume actually occurs.
     */
    async resume(): Promise<void> {
        if (this._entity.closed || !this._entity.paused) return
        await this._entity.resume()
        this.emit(MediaEntityEvent.Resumed)
    }

    /**
     * Closes the entity and releases its resources. Idempotent: safe to call
     * multiple times, and {@link MediaEntityEvent.Closed} is emitted only once.
     */
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
