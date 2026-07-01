import { z } from 'zod'

/**
 * Discriminator identifying a signaling payload as belonging to this media
 * package, letting media signals share a room's signaling channel with other kinds.
 */
export const SignalKind = {
    /** Marks the payload as a WebRTC media negotiation signal. */
    Media: 'media',
} as const

/** Union of the string values in {@link SignalKind}. */
export type SignalKind = (typeof SignalKind)[keyof typeof SignalKind]

/**
 * The three WebRTC negotiation message types exchanged over the signaling channel.
 */
export const SignalType = {
    /** SDP offer initiating or renegotiating a session. */
    Offer: 'offer',
    /** SDP answer responding to an offer. */
    Answer: 'answer',
    /** An ICE candidate (or `null` end-of-candidates). */
    Ice: 'ice',
} as const

/** Union of the string values in {@link SignalType}. */
export type SignalType = (typeof SignalType)[keyof typeof SignalType]

const IceCandidateSchema = z
    .object({
        candidate: z.string().optional(),
        sdpMLineIndex: z.number().nullable().optional(),
        sdpMid: z.string().nullable().optional(),
        usernameFragment: z.string().nullable().optional(),
    })
    .nullable()

export const MediaSignalSchema = z.discriminatedUnion('type', [
    z.object({
        kind: z.literal(SignalKind.Media),
        type: z.literal(SignalType.Offer),
        sdp: z.string(),
    }),
    z.object({
        kind: z.literal(SignalKind.Media),
        type: z.literal(SignalType.Answer),
        sdp: z.string(),
    }),
    z.object({
        kind: z.literal(SignalKind.Media),
        type: z.literal(SignalType.Ice),
        candidate: IceCandidateSchema,
    }),
])

/**
 * A validated media negotiation signal: a discriminated union over
 * {@link SignalType} carrying an SDP offer, SDP answer, or ICE candidate. Sent
 * peer-to-peer through the room's signaling channel.
 */
export type MediaSignal = z.infer<typeof MediaSignalSchema>

export function isMediaSignal(value: unknown): value is MediaSignal {
    if (typeof value !== 'object' || value === null) return false
    if ((value as Record<string, unknown>).kind !== SignalKind.Media) return false
    return MediaSignalSchema.safeParse(value).success
}
