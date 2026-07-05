import type { types as MsTypes } from 'mediasoup'
import type { MediaRouter } from './MediaRouter.js'
import { type SfuRequest, SfuRequestSchema, type SfuResponse } from './sfuProtocol.js'

/**
 * Server-side SFU control handler. Turns a validated {@link SfuRequest} into the
 * matching {@link MediaRouter} call and returns the {@link SfuResponse} to send
 * back to the peer — so integrators wire one line into their signaling instead of
 * hand-rolling the caps→transport→connect→produce→consume→resume protocol.
 *
 * Ownership is enforced by {@link MediaRouter} (a peer can only touch its own
 * transports); malformed requests and mediasoup validation failures come back as
 * `{ type: 'sfu-error' }` rather than throwing.
 *
 * @example
 * ```ts
 * const router = await mediaService.attachRoom(room)
 * const sfu = new SfuSignalHandler(router)
 * // wire to your signaling: on an inbound SFU message from `peerId`,
 * room.onSfu(async (peerId, msg) => room.send(peerId, await sfu.handle(peerId, msg)))
 * ```
 */
export class SfuSignalHandler {
    constructor(private readonly router: MediaRouter) {}

    /**
     * Validate and dispatch one inbound SFU request from a peer.
     *
     * @param peerId - Id of the requesting peer (used for transport ownership).
     * @param raw - The raw inbound message; validated against {@link SfuRequestSchema}.
     * @returns The response to send back to the peer.
     */
    async handle(peerId: string, raw: unknown): Promise<SfuResponse> {
        const parsed = SfuRequestSchema.safeParse(raw)
        if (!parsed.success) {
            return { type: 'sfu-error', message: 'invalid SFU request' }
        }
        try {
            return await this._dispatch(peerId, parsed.data)
        } catch (err) {
            return { type: 'sfu-error', message: err instanceof Error ? err.message : String(err) }
        }
    }

    private async _dispatch(peerId: string, msg: SfuRequest): Promise<SfuResponse> {
        switch (msg.type) {
            case 'sfu-caps':
                return { type: 'sfu-caps', rtpCapabilities: this.router.rtpCapabilities }
            case 'sfu-create-transport': {
                const transport = await this.router.createWebRtcTransport(peerId, msg.direction)
                return { type: 'sfu-transport-created', transport }
            }
            case 'sfu-connect-transport':
                await this.router.connectTransport(
                    peerId,
                    msg.transportId,
                    msg.dtlsParameters as unknown as MsTypes.DtlsParameters,
                )
                return { type: 'sfu-transport-connected', transportId: msg.transportId }
            case 'sfu-produce': {
                const producer = await this.router.produce(
                    peerId,
                    msg.transportId,
                    msg.kind,
                    msg.rtpParameters as unknown as MsTypes.RtpParameters,
                )
                return { type: 'sfu-produced', producerId: producer.id }
            }
            case 'sfu-consume': {
                const consumer = await this.router.consume(
                    peerId,
                    msg.transportId,
                    msg.producerId,
                    msg.rtpCapabilities as unknown as MsTypes.RtpCapabilities,
                )
                return {
                    type: 'sfu-consumed',
                    consumer: {
                        id: consumer.id,
                        producerId: consumer.producerId,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                        paused: consumer.paused,
                    },
                }
            }
            case 'sfu-resume-consumer':
                await this.router.resumeConsumer(peerId, msg.consumerId)
                return { type: 'sfu-consumer-resumed', consumerId: msg.consumerId }
        }
    }
}
