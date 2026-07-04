import { z } from 'zod'

/**
 * Request/response message types for the SFU control handshake carried over your
 * signaling channel. A client walks this sequence to publish and subscribe:
 * `caps → create-transport → connect-transport → produce`/`consume → resume`.
 *
 * {@link SfuSignalHandler} implements the server side so integrators do not have
 * to hand-roll the protocol (the gap called out in the review). Deep mediasoup
 * parameter objects (`dtlsParameters`, `rtpParameters`, `rtpCapabilities`) are
 * carried opaquely and validated by mediasoup itself when applied; the envelope
 * fields below are zod-validated on ingress.
 */
export const SfuMessageType = {
    GetCapabilities: 'sfu-caps',
    CreateTransport: 'sfu-create-transport',
    ConnectTransport: 'sfu-connect-transport',
    Produce: 'sfu-produce',
    Consume: 'sfu-consume',
    ResumeConsumer: 'sfu-resume-consumer',
} as const

export type SfuMessageType = (typeof SfuMessageType)[keyof typeof SfuMessageType]

const opaque = z.record(z.string(), z.unknown())

/** zod schema validating the envelope of every inbound SFU request. */
export const SfuRequestSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal(SfuMessageType.GetCapabilities) }),
    z.object({
        type: z.literal(SfuMessageType.CreateTransport),
        direction: z.enum(['send', 'recv']),
    }),
    z.object({
        type: z.literal(SfuMessageType.ConnectTransport),
        transportId: z.string().min(1),
        dtlsParameters: opaque,
    }),
    z.object({
        type: z.literal(SfuMessageType.Produce),
        transportId: z.string().min(1),
        kind: z.enum(['audio', 'video']),
        rtpParameters: opaque,
    }),
    z.object({
        type: z.literal(SfuMessageType.Consume),
        transportId: z.string().min(1),
        producerId: z.string().min(1),
        rtpCapabilities: opaque,
    }),
    z.object({
        type: z.literal(SfuMessageType.ResumeConsumer),
        consumerId: z.string().min(1),
    }),
])

/** A validated inbound SFU request. */
export type SfuRequest = z.infer<typeof SfuRequestSchema>

/** The reply the handler returns for a given request (shape depends on `type`). */
export type SfuResponse =
    | { type: 'sfu-caps'; rtpCapabilities: unknown }
    | { type: 'sfu-transport-created'; transport: unknown }
    | { type: 'sfu-transport-connected'; transportId: string }
    | { type: 'sfu-produced'; producerId: string }
    | { type: 'sfu-consumed'; consumer: unknown }
    | { type: 'sfu-consumer-resumed'; consumerId: string }
    | { type: 'sfu-error'; message: string }
