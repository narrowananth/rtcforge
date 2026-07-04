/**
 * A node placed on a {@link HashRing}, with an optional relative weight.
 */
export interface RingNode {
    /** Unique identifier for the node. */
    id: string
    /**
     * Relative weight controlling the share of keys routed to this node; higher weights
     * attract proportionally more keys. Must be greater than `0`.
     * @defaultValue `1`
     */
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

/**
 * Consistent-hashing ring for distributing keys across a set of weighted nodes.
 *
 * `HashRing` uses rendezvous (highest-random-weight) hashing: for a given key it computes a
 * score for every node and returns the highest-scoring one. This yields a stable mapping in
 * which adding or removing a node only remaps the keys that node is responsible for, leaving
 * the rest untouched — ideal for sharding rooms, sessions, or state across a cluster.
 *
 * @remarks
 * Weights bias the scoring so heavier nodes receive proportionally more keys. The hash is a
 * deterministic 53-bit function of the key and node id, so the same inputs always map the same
 * way regardless of insertion order.
 *
 * @example
 * ```ts
 * const ring = new HashRing(['sfu-1', 'sfu-2', { id: 'sfu-3', weight: 2 }])
 * const owner = ring.get('room:abc')      // node responsible for this room
 * const replicas = ring.getN('room:abc', 2) // primary + one backup
 * ring.remove('sfu-2')                     // only sfu-2's keys move
 * ```
 */
export class HashRing {
    private readonly _nodes = new Map<string, number>()

    /**
     * Creates a ring, optionally pre-populated with nodes.
     *
     * @param nodes - Initial nodes to add. Each entry may be a node id string (weight `1`) or a {@link RingNode}.
     * @throws `Error` if any provided {@link RingNode} has a weight less than or equal to `0`.
     */
    constructor(nodes: ReadonlyArray<RingNode | string> = []) {
        for (const n of nodes) this.add(n)
    }

    /**
     * Adds a node to the ring, or updates the weight of an existing node with the same id.
     *
     * @param node - A node id string (weight `1`) or a {@link RingNode} with an explicit weight.
     * @throws `Error` if `node` is a {@link RingNode} with a weight less than or equal to `0`.
     */
    add(node: RingNode | string): void {
        if (typeof node === 'string') {
            this._nodes.set(node, 1)
            return
        }
        const weight = node.weight ?? 1
        // Reject NaN/Infinity as well as ≤0: a NaN weight makes the node score NaN
        // and win zero keys (silently invisible); Infinity makes it win every key.
        if (!Number.isFinite(weight) || weight <= 0)
            throw new Error(
                `HashRing: weight must be a finite number > 0 (got ${weight} for ${node.id})`,
            )
        this._nodes.set(node.id, weight)
    }

    /**
     * Removes a node from the ring.
     *
     * @param id - The id of the node to remove.
     * @returns `true` if a node was removed, `false` if no node with that id existed.
     */
    remove(id: string): boolean {
        return this._nodes.delete(id)
    }

    /**
     * Checks whether a node with the given id is on the ring.
     *
     * @param id - The node id to test.
     * @returns `true` if the node is present.
     */
    has(id: string): boolean {
        return this._nodes.has(id)
    }

    /**
     * The number of nodes currently on the ring.
     */
    get size(): number {
        return this._nodes.size
    }

    /**
     * Returns the ids of all nodes currently on the ring.
     *
     * @returns A new array of node ids, in insertion order.
     */
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

    /**
     * Returns the single node responsible for `key`.
     *
     * @param key - The key to route (e.g. a room or session identifier).
     * @returns The id of the highest-scoring node, or `undefined` if the ring is empty.
     */
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

    /**
     * Returns the top `n` nodes responsible for `key`, in descending score order.
     *
     * @param key - The key to route.
     * @param n - The maximum number of nodes to return.
     * @returns Up to `n` node ids ordered from most to least preferred; empty if `n` is not positive or the ring is empty. Useful for selecting a primary plus replicas.
     */
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
