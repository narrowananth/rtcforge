/**
 * Source of unique string identifiers.
 *
 * @remarks
 * Inject an `IdGenerator` wherever ids are minted so production code can use random,
 * collision-resistant ids ({@link randomId}) while tests use predictable, sequential ids
 * ({@link SequentialId}).
 */
export interface IdGenerator {
    /**
     * Produces the next identifier.
     * @returns A new identifier string.
     */
    next(): string
}

/**
 * An {@link IdGenerator} that returns a fresh random UUID (v4) on each call, via
 * `globalThis.crypto.randomUUID()`.
 *
 * @remarks
 * Requires the Web Crypto API to be available on the host.
 */
export const randomId: IdGenerator = {
    next: () => globalThis.crypto.randomUUID(),
}

/**
 * An {@link IdGenerator} that yields deterministic, monotonically increasing ids of the form
 * `<prefix><n>` (e.g. `id-1`, `id-2`).
 *
 * @remarks
 * Primarily intended for tests and snapshots where stable, predictable ids are desirable.
 * Not collision-resistant across separate instances.
 *
 * @example
 * ```ts
 * const ids = new SequentialId('peer-')
 * ids.next() // 'peer-1'
 * ids.next() // 'peer-2'
 * ```
 */
export class SequentialId implements IdGenerator {
    private _n = 0
    /**
     * @param _prefix - String prepended to the incrementing counter.
     * @defaultValue `'id-'`
     */
    constructor(private readonly _prefix = 'id-') {}
    /**
     * Increments the internal counter and returns the next id.
     * @returns The id `<prefix><n>`, starting at `<prefix>1`.
     */
    next(): string {
        this._n += 1
        return `${this._prefix}${this._n}`
    }
}
