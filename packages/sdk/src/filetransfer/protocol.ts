import { z } from 'zod'

/**
 * Message types exchanged over the file-transfer control channel.
 *
 * The control channel ({@link CONTROL_CHANNEL_LABEL}) carries the transfer
 * handshake and lifecycle signalling; bulk chunk data flows on separate
 * per-transfer data channels (see {@link dataChannelLabel}). Every control
 * message references a `transferId`.
 */
export const ControlType = {
    /** Sender → receiver: proposes a transfer with its file metadata and tuning; the opening message of the handshake. */
    Offer: 'ft-offer',
    /** Receiver → sender: accepts an offer, optionally reporting already-held chunks (`haveChunks`) so the sender can resume. */
    Accept: 'ft-accept',
    /** Receiver → sender: declines an offer, optionally with a `reason`. */
    Reject: 'ft-reject',
    /** Receiver → sender: requests retransmission, listing the chunk indices it still needs. */
    ResumeRequest: 'ft-resume-request',

    /** Sender → receiver: all chunks have been written to the wire; optionally carries the expected `digest` for verification. */
    Sent: 'ft-sent',

    /** Receiver → sender: all chunks received and (if enabled) the checksum verified; the transfer succeeded. */
    Complete: 'ft-complete',
    /** Receiver → sender: the received data's digest did not match the sender's. */
    ChecksumMismatch: 'ft-checksum-mismatch',
    /** Either peer: aborts the transfer, optionally with a `reason`. */
    Cancel: 'ft-cancel',
    /** Either peer: requests the transfer be paused. */
    Pause: 'ft-pause',
    /** Either peer: requests a paused transfer resume. */
    Resume: 'ft-resume',
} as const

/**
 * One of the string literal values in {@link ControlType}.
 */
export type ControlType = (typeof ControlType)[keyof typeof ControlType]

export const ControlMessageSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal(ControlType.Offer),
        transferId: z.string(),
        name: z.string(),
        mimeType: z.string(),
        size: z.number().int().nonnegative(),
        chunkSize: z.number().int().positive(),
        totalChunks: z.number().int().nonnegative(),
        parallelChannels: z.number().int().positive(),
        checksum: z.boolean(),
    }),
    z.object({
        type: z.literal(ControlType.Accept),
        transferId: z.string(),

        haveChunks: z.array(z.number().int().nonnegative()).optional(),
    }),
    z.object({
        type: z.literal(ControlType.Reject),
        transferId: z.string(),
        reason: z.string().optional(),
    }),
    z.object({
        type: z.literal(ControlType.ResumeRequest),
        transferId: z.string(),
        haveChunks: z.array(z.number().int().nonnegative()),
    }),
    z.object({
        type: z.literal(ControlType.Sent),
        transferId: z.string(),

        digest: z.string().optional(),
    }),
    z.object({
        type: z.literal(ControlType.Complete),
        transferId: z.string(),
    }),
    z.object({
        type: z.literal(ControlType.ChecksumMismatch),
        transferId: z.string(),
    }),
    z.object({
        type: z.literal(ControlType.Cancel),
        transferId: z.string(),
        reason: z.string().optional(),
    }),
    z.object({ type: z.literal(ControlType.Pause), transferId: z.string() }),
    z.object({ type: z.literal(ControlType.Resume), transferId: z.string() }),
])

/**
 * Discriminated union of every control-channel message, validated by
 * `ControlMessageSchema`. Discriminate on the `type` field ({@link ControlType}).
 */
export type ControlMessage = z.infer<typeof ControlMessageSchema>

/**
 * The `ft-offer` variant of {@link ControlMessage}: file metadata and transfer
 * tuning (`transferId`, `name`, `mimeType`, `size`, `chunkSize`, `totalChunks`,
 * `parallelChannels`, `checksum`) advertised by the sender at handshake start.
 */
export type OfferMessage = Extract<ControlMessage, { type: typeof ControlType.Offer }>

/**
 * Fixed label of the shared data channel used for control signalling between
 * two peers. All {@link ControlMessage}s travel over the channel with this label.
 */
export const CONTROL_CHANNEL_LABEL = 'rtcforge-ft-ctrl'

/**
 * Build the label for one of a transfer's parallel data channels.
 *
 * Labels follow the scheme `rtcforge-ft-<transferId>-<index>`, letting the
 * receiver route an incoming channel to the correct transfer and lane.
 *
 * @param transferId - Id of the transfer the channel belongs to.
 * @param index - Zero-based index of the parallel channel within the transfer.
 * @returns The data-channel label.
 */
export function dataChannelLabel(transferId: string, index: number): string {
    return `rtcforge-ft-${transferId}-${index}`
}

/**
 * Parse a data-channel label produced by {@link dataChannelLabel}.
 *
 * @param label - The channel label to parse.
 * @returns The extracted `transferId` and channel `index`, or `null` if the label is not a file-transfer data-channel label.
 */
export function parseDataChannelLabel(label: string): { transferId: string; index: number } | null {
    const m = /^rtcforge-ft-(.+)-(\d+)$/.exec(label)
    if (!m) return null
    return { transferId: m[1] as string, index: Number(m[2]) }
}
