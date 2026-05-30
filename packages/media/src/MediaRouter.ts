import { EventEmitter } from '@rtcforge/core'
import { Consumer, ConsumerEvent } from './Consumer.js'
import { Producer, ProducerEvent } from './Producer.js'

export const MediaRouterEvent = {
    ProducerCreated: 'producerCreated',
    ProducerClosed: 'producerClosed',
    ConsumerCreated: 'consumerCreated',
    Closed: 'closed',
} as const

type MediaRouterEvents = {
    [MediaRouterEvent.ProducerCreated]: [producer: Producer]
    [MediaRouterEvent.ProducerClosed]: [producer: Producer]
    [MediaRouterEvent.ConsumerCreated]: [consumer: Consumer]
    [MediaRouterEvent.Closed]: []
}

export class MediaRouter extends EventEmitter<MediaRouterEvents> {
    readonly id: string
    private readonly _producers = new Map<string, Producer>()
    private readonly _consumers = new Map<string, Consumer>()
    private _closed = false

    constructor(id: string) {
        super()
        this.id = id
    }

    get producerCount(): number {
        return this._producers.size
    }

    get consumerCount(): number {
        return this._consumers.size
    }

    createProducer(peerId: string, kind: 'audio' | 'video'): Producer {
        if (this._closed) throw new Error('MediaRouter is closed')
        const producer = new Producer(peerId, kind)
        this._producers.set(producer.id, producer)
        producer.once(ProducerEvent.Closed, () => {
            this._producers.delete(producer.id)
            const toClose: Consumer[] = []
            for (const consumer of this._consumers.values()) {
                if (consumer.producerId === producer.id) toClose.push(consumer)
            }
            for (const consumer of toClose) consumer.close()
            this.emit(MediaRouterEvent.ProducerClosed, producer)
        })
        this.emit(MediaRouterEvent.ProducerCreated, producer)
        return producer
    }

    createConsumer(subscriberPeerId: string, producerId: string): Consumer {
        if (this._closed) throw new Error('MediaRouter is closed')
        const producer = this._producers.get(producerId)
        if (!producer) throw new Error(`Producer not found: ${producerId}`)
        const consumer = new Consumer(subscriberPeerId, producer.kind, producerId)
        this._consumers.set(consumer.id, consumer)
        consumer.once(ConsumerEvent.Closed, () => this._consumers.delete(consumer.id))
        this.emit(MediaRouterEvent.ConsumerCreated, consumer)
        return consumer
    }

    private _closeForPeer<T extends { peerId: string; close(): void }>(
        map: Map<string, T>,
        peerId: string,
    ): void {
        const toClose: T[] = []
        for (const entity of map.values()) {
            if (entity.peerId === peerId) toClose.push(entity)
        }
        for (const entity of toClose) entity.close()
    }

    closeProducersForPeer(peerId: string): void {
        this._closeForPeer(this._producers, peerId)
    }

    closeConsumersForPeer(peerId: string): void {
        this._closeForPeer(this._consumers, peerId)
    }

    close(): void {
        if (this._closed) return
        this._closed = true
        for (const producer of [...this._producers.values()]) producer.close()
        for (const consumer of [...this._consumers.values()]) consumer.close()
        this.emit(MediaRouterEvent.Closed)
    }
}
