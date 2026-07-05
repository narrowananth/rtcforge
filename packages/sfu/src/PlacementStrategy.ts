import { HashRing } from 'rtcforge-core'
import type { SfuNode } from './SfuNode.js'
import type { PlacementStrategy } from './types.js'

function regionalPool(candidates: SfuNode[], region?: string): SfuNode[] {
    if (!region) return candidates
    const regional = candidates.filter((n) => n.region === region)
    return regional.length > 0 ? regional : candidates
}

/**
 * {@link PlacementStrategy} that picks the candidate node with the lowest current load.
 *
 * @remarks
 * When a `region` is given it prefers nodes in that region, falling back to the
 * full candidate set if none match, then returns the least-loaded node from the
 * chosen pool. Ignores the routing `key` — placement is purely load-driven, which
 * spreads rooms evenly but does not keep a given room pinned to one node across
 * calls. For stable pinning use {@link HashRingStrategy}.
 */
export class LeastLoadedStrategy implements PlacementStrategy {
    select(candidates: SfuNode[], region?: string, _key?: string): SfuNode | undefined {
        if (candidates.length === 0) return undefined
        const pool = regionalPool(candidates, region)
        return pool.reduce((min, n) => (n.load < min.load ? n : min))
    }
}

/**
 * {@link PlacementStrategy} that pins a key to a node via consistent hashing.
 *
 * @remarks
 * Preferring the given `region`, it maps the routing `key` (e.g. a room id) onto
 * a capacity-weighted {@link HashRing} so the same key consistently lands on the
 * same node while the node set is stable, and only minimally reshuffles when
 * nodes join or leave. The ring is rebuilt only when the candidate pool's
 * id/weight signature changes. With no `key`, it falls back to the first
 * candidate.
 */
export class HashRingStrategy implements PlacementStrategy {
    private _ring: HashRing | null = null
    private _ringSig = ''

    select(candidates: SfuNode[], region?: string, key?: string): SfuNode | undefined {
        if (candidates.length === 0) return undefined
        const pool = regionalPool(candidates, region)
        if (key === undefined) return pool[0]

        const byId = new Map(pool.map((n) => [n.id, n]))
        const ownerId = this._ringFor(pool).get(key)
        return ownerId !== undefined ? byId.get(ownerId) : undefined
    }

    private _ringFor(pool: SfuNode[]): HashRing {
        const nodes = pool.map((n) => ({ id: n.id, weight: Math.max(1, n.capacity) }))
        const sig = nodes
            .map((n) => `${n.id}:${n.weight}`)
            .sort()
            .join('|')
        if (this._ring === null || sig !== this._ringSig) {
            this._ring = new HashRing(nodes)
            this._ringSig = sig
        }
        return this._ring
    }
}
