import type { types as MsTypes } from 'mediasoup'
import { MediaEntity } from './MediaEntity.js'

export class Consumer extends MediaEntity {
    readonly role = 'consumer' as const
    readonly producerId: string

    constructor(
        peerId: string,
        producerId: string,
        private readonly consumer: MsTypes.Consumer,
    ) {
        super(peerId, consumer)
        this.producerId = producerId
        consumer.on('producerclose', () => this.close())
    }

    get rtpParameters(): MsTypes.RtpParameters {
        return this.consumer.rtpParameters
    }
}
