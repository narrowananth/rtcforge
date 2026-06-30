export interface IdGenerator {
    next(): string
}

export const randomId: IdGenerator = {
    next: () => globalThis.crypto.randomUUID(),
}

export class SequentialId implements IdGenerator {
    private _n = 0
    constructor(private readonly _prefix = 'id-') {}
    next(): string {
        this._n += 1
        return `${this._prefix}${this._n}`
    }
}
