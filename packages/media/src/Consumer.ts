import type { types as MsTypes } from 'mediasoup'
import { MediaEntity } from './MediaEntity.js'

/**
 * Server-side (mediasoup SFU) representation of a {@link Producer} being
 * delivered to a consuming peer. Created paused; call {@link MediaEntity.resume}
 * (or {@link MediaRouter.resumeConsumer}) once the client transport is ready.
 * Closes automatically when its source producer closes.
 */
export class Consumer extends MediaEntity {
    /** Always `"consumer"`. */
    readonly role = 'consumer' as const
    /** Id of the source {@link Producer} this consumer receives from. */
    readonly producerId: string

    /**
     * @param peerId - Id of the peer receiving this stream.
     * @param producerId - Id of the source producer being consumed.
     * @param consumer - The underlying mediasoup consumer to wrap.
     */
    constructor(
        peerId: string,
        producerId: string,
        private readonly consumer: MsTypes.Consumer,
    ) {
        super(peerId, consumer)
        this.producerId = producerId
        consumer.on('producerclose', () => this.close())
    }

    /** RTP parameters the client needs to receive and decode this consumer. */
    get rtpParameters(): MsTypes.RtpParameters {
        return this.consumer.rtpParameters
    }
}
