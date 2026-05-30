import { MediaEntity, MediaEntityEvent } from './MediaEntity.js'

export const ProducerEvent = MediaEntityEvent
export type ProducerEvent = MediaEntityEvent

export class Producer extends MediaEntity {
    constructor(peerId: string, kind: 'audio' | 'video') {
        super('producer', peerId, kind)
    }
}
