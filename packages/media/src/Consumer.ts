import { MediaEntity, MediaEntityEvent } from './MediaEntity.js'

export const ConsumerEvent = MediaEntityEvent
export type ConsumerEvent = MediaEntityEvent

export class Consumer extends MediaEntity {
    readonly producerId: string

    constructor(peerId: string, kind: 'audio' | 'video', producerId: string) {
        super('consumer', peerId, kind)
        this.producerId = producerId
    }
}
