import type { types as MsTypes } from 'mediasoup'
import { MediaEntity } from './MediaEntity.js'

export class Producer extends MediaEntity {
    readonly role = 'producer' as const

    constructor(
        peerId: string,
        private readonly producer: MsTypes.Producer,
    ) {
        super(peerId, producer)

        producer.observer.once('close', () => this.close())
    }

    get transportId(): string {
        return this.producer.appData.transportId as string
    }
}
