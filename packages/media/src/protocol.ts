import { z } from 'zod'

export const SignalKind = {
    Media: 'media',
} as const

export type SignalKind = (typeof SignalKind)[keyof typeof SignalKind]

export const SignalType = {
    Offer: 'offer',
    Answer: 'answer',
    Ice: 'ice',
} as const

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

export type MediaSignal = z.infer<typeof MediaSignalSchema>

export function isMediaSignal(value: unknown): value is MediaSignal {
    if (typeof value !== 'object' || value === null) return false
    if ((value as Record<string, unknown>).kind !== SignalKind.Media) return false
    return MediaSignalSchema.safeParse(value).success
}
