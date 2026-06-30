import { HashRing } from '@rtcforge/core'
import type { SfuNode } from './SfuNode.js'
import type { PlacementStrategy } from './types.js'

function regionalPool(candidates: SfuNode[], region?: string): SfuNode[] {
    if (!region) return candidates
    const regional = candidates.filter((n) => n.region === region)
    return regional.length > 0 ? regional : candidates
}

export class LeastLoadedStrategy implements PlacementStrategy {
    select(candidates: SfuNode[], region?: string, _key?: string): SfuNode | undefined {
        if (candidates.length === 0) return undefined
        const pool = regionalPool(candidates, region)
        return pool.reduce((min, n) => (n.load < min.load ? n : min))
    }
}

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
