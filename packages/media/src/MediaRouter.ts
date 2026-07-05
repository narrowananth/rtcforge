import type { types as MsTypes } from 'mediasoup'
import { EventEmitter, noopLogger } from 'rtcforge-core'
import type { Logger, MediaKind } from 'rtcforge-core'
import { Consumer } from './Consumer.js'
import { MediaEntityEvent } from './MediaEntity.js'
import { Producer } from './Producer.js'
import { DEFAULT_LISTEN_INFOS } from './types.js'
import type {
    PipeProducerParams,
    PipeTransportParams,
    WebRtcTransportConfig,
    WebRtcTransportParams,
} from './types.js'

/**
 * Events emitted by a {@link MediaRouter}.
 */
export const MediaRouterEvent = {
    /** A producer was created or piped in. Payload: `(producer)`. */
    ProducerAdded: 'producerAdded',
    /** A producer closed and was removed from the router. Payload: `(producer)`. */
    ProducerClosed: 'producerClosed',
    /** A consumer was created. Payload: `(consumer)`. */
    ConsumerAdded: 'consumerAdded',
    /** The router was closed. */
    Closed: 'closed',
} as const

type MediaRouterEvents = {
    [MediaRouterEvent.ProducerAdded]: [producer: Producer]
    [MediaRouterEvent.ProducerClosed]: [producer: Producer]
    [MediaRouterEvent.ConsumerAdded]: [consumer: Consumer]
    [MediaRouterEvent.Closed]: []
}

const PIPE_PEER_ID = 'pipe'

/** Declared role of a WebRTC transport: only sends media, or only receives it. */
export type TransportDirection = 'send' | 'recv'

export class MediaRouter extends EventEmitter<MediaRouterEvents> {
    readonly id: string
    private readonly _router: MsTypes.Router
    private readonly _config: WebRtcTransportConfig
    private readonly _logger: Logger
    private readonly _transports = new Map<string, MsTypes.WebRtcTransport>()
    private readonly _pipeTransports = new Map<string, MsTypes.PipeTransport>()
    private readonly _producers = new Map<string, Producer>()
    private readonly _consumers = new Map<string, Consumer>()
    private _closed = false

    constructor(
        id: string,
        router: MsTypes.Router,
        config: WebRtcTransportConfig = {},
        logger: Logger = noopLogger,
    ) {
        super()
        this.id = id
        this._router = router
        this._config = config
        this._logger = logger
        // The underlying mediasoup router closes on its own when its worker dies.
        // Observe that so a worker crash flips our state and emits Closed, letting
        // MediaService reap the dead router instead of handing it back forever.
        this._router.observer.once('close', () => {
            if (this._closed) return
            this._closed = true
            this._transports.clear()
            this._pipeTransports.clear()
            this.emit(MediaRouterEvent.Closed)
        })
    }

    get rtpCapabilities(): MsTypes.RtpCapabilities {
        return this._router.rtpCapabilities
    }

    get producerCount(): number {
        return this._producers.size
    }

    get consumerCount(): number {
        return this._consumers.size
    }

    async createWebRtcTransport(
        peerId: string,
        direction?: TransportDirection,
    ): Promise<WebRtcTransportParams> {
        this._assertOpen()
        const transport = await this._router.createWebRtcTransport({
            listenInfos: this._config.listenInfos ?? [...DEFAULT_LISTEN_INFOS],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            enableSctp: this._config.enableSctp ?? false,
            initialAvailableOutgoingBitrate: this._config.initialAvailableOutgoingBitrate,
            // Record the declared direction so produce/consume can enforce it: a
            // recv-only transport must not produce, a send-only must not consume.
            appData: { peerId, direction },
        })

        if (this._config.maxIncomingBitrate !== undefined) {
            await transport.setMaxIncomingBitrate(this._config.maxIncomingBitrate).catch(() => {})
        }

        this._transports.set(transport.id, transport)
        transport.observer.once('close', () => this._transports.delete(transport.id))

        return {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            ...(transport.sctpParameters && { sctpParameters: transport.sctpParameters }),
        }
    }

    async connectTransport(
        peerId: string,
        transportId: string,
        dtlsParameters: MsTypes.DtlsParameters,
    ): Promise<void> {
        await this._requireOwnedTransport(peerId, transportId).connect({ dtlsParameters })
    }

    async produce(
        peerId: string,
        transportId: string,
        kind: MediaKind,
        rtpParameters: MsTypes.RtpParameters,
    ): Promise<Producer> {
        this._assertOpen()
        const transport = this._requireOwnedTransport(peerId, transportId)
        if (this._directionOf(transport) === 'recv') {
            throw new Error(`Transport ${transportId} is recv-only; cannot produce`)
        }
        const msProducer = await transport.produce({
            kind,
            rtpParameters,
            appData: { peerId, transportId },
        })
        const producer = new Producer(peerId, msProducer)
        this._registerProducer(producer)
        return producer
    }

    async consume(
        peerId: string,
        transportId: string,
        producerId: string,
        rtpCapabilities: MsTypes.RtpCapabilities,
    ): Promise<Consumer> {
        this._assertOpen()
        if (!this._producers.has(producerId)) throw new Error(`Producer not found: ${producerId}`)
        if (!this._router.canConsume({ producerId, rtpCapabilities })) {
            throw new Error(`Cannot consume producer ${producerId} with given capabilities`)
        }
        const transport = this._requireOwnedTransport(peerId, transportId)
        if (this._directionOf(transport) === 'send') {
            throw new Error(`Transport ${transportId} is send-only; cannot consume`)
        }
        const msConsumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true,
            appData: { peerId, producerId },
        })
        const consumer = new Consumer(peerId, producerId, msConsumer)
        this._consumers.set(consumer.id, consumer)
        consumer.once(MediaEntityEvent.Closed, () => this._consumers.delete(consumer.id))
        this.emit(MediaRouterEvent.ConsumerAdded, consumer)
        return consumer
    }

    async resumeConsumer(peerId: string, consumerId: string): Promise<void> {
        // Throw for an unknown consumer rather than silently succeeding: the
        // caller (SfuSignalHandler) otherwise replies `sfu-consumer-resumed`
        // and the client believes media is flowing when nothing resumed.
        const consumer = requireFrom(this._consumers, consumerId, 'Consumer')
        // Ownership: only the peer the consumer belongs to may resume it.
        if (consumer.peerId !== peerId) {
            throw new Error(`Consumer ${consumerId} does not belong to peer ${peerId}`)
        }
        await consumer.resume()
    }

    async pipeProducerTo(producerId: string, dest: MediaRouter): Promise<void> {
        this._assertOpen()
        if (dest._hasProducer(producerId)) return
        const { pipeProducer } = await this._router.pipeToRouter({
            producerId,
            router: dest._internalRouter(),
        })
        if (!pipeProducer) {
            this._logger.warn('pipeToRouter returned no pipeProducer; destination unregistered', {
                producerId,
                fromRoom: this.id,
                toRoom: dest.id,
            })
            return
        }
        const peerId = this._producers.get(producerId)?.peerId ?? PIPE_PEER_ID

        dest._acceptPipedProducer(peerId, pipeProducer)
    }

    private _hasProducer(producerId: string): boolean {
        return this._producers.has(producerId)
    }

    private _internalRouter(): MsTypes.Router {
        this._assertOpen()
        return this._router
    }

    private _acceptPipedProducer(peerId: string, pipeProducer: MsTypes.Producer): void {
        this._assertOpen()
        this._registerProducer(new Producer(peerId, pipeProducer))
    }

    async createPipeTransport(): Promise<PipeTransportParams> {
        this._assertOpen()
        const transport = await this._router.createPipeTransport({
            listenInfo: this._config.listenInfos?.[0] ?? DEFAULT_LISTEN_INFOS[0],
            enableRtx: true,
            enableSrtp: true,
        })
        this._pipeTransports.set(transport.id, transport)
        transport.observer.once('close', () => this._pipeTransports.delete(transport.id))
        return {
            id: transport.id,
            ip: transport.tuple.localAddress,
            port: transport.tuple.localPort,
            srtpParameters: transport.srtpParameters,
        }
    }

    async connectPipeTransport(
        pipeTransportId: string,
        remote: PipeTransportParams,
    ): Promise<void> {
        const transport = this._requirePipeTransport(pipeTransportId)
        await transport.connect({
            ip: remote.ip,
            port: remote.port,
            srtpParameters: remote.srtpParameters,
        })
    }

    async pipeConsume(pipeTransportId: string, producerId: string): Promise<PipeProducerParams> {
        const transport = this._requirePipeTransport(pipeTransportId)
        const consumer = await transport.consume({ producerId })
        return {
            id: producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            paused: consumer.producerPaused,
        }
    }

    async pipeProduce(pipeTransportId: string, params: PipeProducerParams): Promise<Producer> {
        this._assertOpen()
        const transport = this._requirePipeTransport(pipeTransportId)
        const msProducer = await transport.produce({
            id: params.id,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
            paused: params.paused,
            // Stamp the pipe transport id so Producer.transportId is populated
            // for producers created over a pipe transport.
            appData: { transportId: pipeTransportId },
        })
        const producer = new Producer(PIPE_PEER_ID, msProducer)
        this._registerProducer(producer)
        return producer
    }

    closeTransportsForPeer(peerId: string): void {
        for (const transport of [...this._transports.values()]) {
            if (transport.appData.peerId === peerId) transport.close()
        }
    }

    close(): void {
        if (this._closed) return
        this._closed = true
        for (const transport of [...this._transports.values()]) transport.close()
        this._transports.clear()
        this._pipeTransports.clear()
        this._router.close()
        this.emit(MediaRouterEvent.Closed)
    }

    private _registerProducer(producer: Producer): void {
        this._producers.set(producer.id, producer)
        producer.once(MediaEntityEvent.Closed, () => {
            this._producers.delete(producer.id)
            this.emit(MediaRouterEvent.ProducerClosed, producer)
        })
        this.emit(MediaRouterEvent.ProducerAdded, producer)
    }

    private _assertOpen(): void {
        if (this._closed) throw new Error('MediaRouter is closed')
    }

    private _requireTransport(transportId: string): MsTypes.WebRtcTransport {
        return requireFrom(this._transports, transportId, 'Transport')
    }

    // Verify the caller owns the transport (matches the peerId stamped into
    // appData at creation). Without this, a peer that learns another peer's
    // transportId over signaling could connect/produce/consume on it.
    private _requireOwnedTransport(peerId: string, transportId: string): MsTypes.WebRtcTransport {
        const transport = this._requireTransport(transportId)
        if ((transport.appData as { peerId?: string }).peerId !== peerId) {
            throw new Error(`Transport ${transportId} does not belong to peer ${peerId}`)
        }
        return transport
    }

    // The direction declared at creation, or undefined for transports created
    // without one (legacy callers) — in which case direction is not enforced.
    private _directionOf(transport: MsTypes.WebRtcTransport): TransportDirection | undefined {
        return (transport.appData as { direction?: TransportDirection }).direction
    }

    private _requirePipeTransport(pipeTransportId: string): MsTypes.PipeTransport {
        return requireFrom(this._pipeTransports, pipeTransportId, 'Pipe transport')
    }
}

function requireFrom<T>(map: Map<string, T>, id: string, label: string): T {
    const value = map.get(id)
    if (!value) throw new Error(`${label} not found: ${id}`)
    return value
}
