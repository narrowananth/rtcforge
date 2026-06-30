export interface RingNode {
    id: string
    weight?: number
}

function cyrb53(str: string, seed = 0): number {
    let h1 = 0xdeadbeef ^ seed
    let h2 = 0x41c6ce57 ^ seed
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i)
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

const MAX_HASH = 2 ** 53

export class HashRing {
    private readonly _nodes = new Map<string, number>()

    constructor(nodes: ReadonlyArray<RingNode | string> = []) {
        for (const n of nodes) this.add(n)
    }

    add(node: RingNode | string): void {
        if (typeof node === 'string') {
            this._nodes.set(node, 1)
            return
        }
        const weight = node.weight ?? 1
        if (weight <= 0)
            throw new Error(`HashRing: weight must be > 0 (got ${weight} for ${node.id})`)
        this._nodes.set(node.id, weight)
    }

    remove(id: string): boolean {
        return this._nodes.delete(id)
    }

    has(id: string): boolean {
        return this._nodes.has(id)
    }

    get size(): number {
        return this._nodes.size
    }

    nodeIds(): string[] {
        return [...this._nodes.keys()]
    }

    private _score(key: string, id: string, weight: number): number {
        const h = cyrb53(`${key}|${id}`)
        let unit = h / MAX_HASH
        if (unit <= 0) unit = Number.MIN_VALUE
        if (unit >= 1) unit = 1 - Number.EPSILON
        return weight / -Math.log(unit)
    }

    get(key: string): string | undefined {
        let bestId: string | undefined
        let bestScore = Number.NEGATIVE_INFINITY
        for (const [id, weight] of this._nodes) {
            const score = this._score(key, id, weight)
            if (score > bestScore) {
                bestScore = score
                bestId = id
            }
        }
        return bestId
    }

    getN(key: string, n: number): string[] {
        if (n <= 0 || this._nodes.size === 0) return []
        const scored: Array<{ id: string; score: number }> = []
        for (const [id, weight] of this._nodes) {
            scored.push({ id, score: this._score(key, id, weight) })
        }
        scored.sort((a, b) => b.score - a.score)
        return scored.slice(0, n).map((s) => s.id)
    }
}
