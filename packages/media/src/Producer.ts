import type { types as MsTypes } from 'mediasoup'
import { MediaEntity } from './MediaEntity.js'

/**
 * Server-side (mediasoup SFU) representation of a track a peer is sending into a
 * {@link MediaRouter}. Wraps a mediasoup `Producer` and exposes the shared
 * lifecycle from {@link MediaEntity} (pause/resume/close and events).
 */
export class Producer extends MediaEntity {
    /** Always `"producer"`. */
    readonly role = 'producer' as const

    /**
     * @param peerId - Id of the peer that owns this producer.
     * @param producer - The underlying mediasoup producer to wrap.
     */
    constructor(
        peerId: string,
        private readonly producer: MsTypes.Producer,
    ) {
        super(peerId, producer)

        producer.observer.once('close', () => this.close())
    }

    /**
     * Id of the transport this producer sends on, or `undefined` for a producer
     * that was piped in from another router via `pipeToRouter` (which has no
     * client-facing transport of its own).
     */
    get transportId(): string | undefined {
        return this.producer.appData.transportId as string | undefined
    }
}
