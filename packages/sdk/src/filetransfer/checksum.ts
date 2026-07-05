import { FileTransferError, FileTransferErrorCode } from './errors.js'

/**
 * Order-independent, incremental SHA-256 accumulator for chunked transfers.
 *
 * Because chunks may arrive out of order across parallel channels, each chunk
 * is hashed independently and keyed by its sequence number. {@link finalize}
 * concatenates the per-chunk digests in ascending sequence order and hashes the
 * result, yielding a deterministic value both peers can compute and compare.
 *
 * @remarks The result is a digest-of-digests, not the SHA-256 of the whole file.
 * Both sender and receiver must use this class to produce matching values.
 *
 * @remarks By design this retains one 32-byte per-chunk digest until {@link finalize},
 * i.e. O(chunks) memory. This is an intentional space/verification tradeoff — it enables
 * order-independent, resumable hashing across parallel channels — and is deliberately not
 * redesigned into a streaming single-pass hash.
 */
export class Sha256Digest {
    private readonly _digests = new Map<number, Uint8Array>()

    /**
     * Hash one chunk and record its digest under the given sequence number.
     * Re-updating the same `seq` overwrites the previous digest.
     *
     * @param seq - Chunk sequence number, used to order digests at finalization.
     * @param bytes - The chunk payload to hash.
     */
    async update(seq: number, bytes: Uint8Array): Promise<void> {
        this._digests.set(seq, await sha256Raw(bytes))
    }

    /**
     * Concatenate all recorded per-chunk digests in ascending sequence order and
     * hash the concatenation.
     *
     * @returns The lowercase hex-encoded SHA-256 of the ordered digest stream.
     */
    async finalize(): Promise<string> {
        const seqs = [...this._digests.keys()].sort((a, b) => a - b)
        const joined = new Uint8Array(seqs.length * 32)
        let offset = 0
        for (const s of seqs) {
            joined.set(this._digests.get(s) as Uint8Array, offset)
            offset += 32
        }
        return sha256Hex(joined)
    }

    /** Discard all recorded chunk digests so the accumulator can be reused. */
    reset(): void {
        this._digests.clear()
    }
}

/**
 * Compute the raw SHA-256 digest of a buffer using WebCrypto's SubtleCrypto.
 *
 * @param bytes - The data to hash.
 * @returns The 32-byte digest.
 * @throws {@link FileTransferError} with code `FT_INVALID_STATE` if SubtleCrypto is unavailable in the current environment.
 */
export async function sha256Raw(bytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) {
        throw new FileTransferError(
            'WebCrypto SubtleCrypto is unavailable; cannot compute checksum',
            FileTransferErrorCode.InvalidState,
        )
    }

    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    const digest = await subtle.digest('SHA-256', view as unknown as BufferSource)
    return new Uint8Array(digest)
}

/**
 * Compute the SHA-256 digest of a buffer and return it as a lowercase hex string.
 *
 * @param bytes - The data to hash.
 * @returns The 64-character lowercase hex-encoded digest.
 * @throws {@link FileTransferError} with code `FT_INVALID_STATE` if SubtleCrypto is unavailable in the current environment.
 */
export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
    return hex(await sha256Raw(bytes))
}

function hex(bytes: Uint8Array): string {
    let out = ''
    for (const b of bytes) out += b.toString(16).padStart(2, '0')
    return out
}
