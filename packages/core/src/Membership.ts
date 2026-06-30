import { type Clock, systemClock } from './Clock.js'

export interface NodeInfo {
    id: string
    region?: string
    address?: string
    metadata?: Record<string, string>
}

export interface Membership {
    register(node: NodeInfo, ttlMs: number): Promise<void>
    deregister(nodeId: string): Promise<void>
    list(): Promise<NodeInfo[]>
    watch(callback: (nodes: NodeInfo[]) => void): () => void
}

interface MembershipEntry {
    node: NodeInfo
    expiresAt: number
}

export class MemoryMembership implements Membership {
    private readonly _nodes = new Map<string, MembershipEntry>()
    private readonly _watchers = new Set<(nodes: NodeInfo[]) => void>()

    constructor(private readonly _clock: Clock = systemClock) {}

    private _prune(): boolean {
        const now = this._clock.now()
        let changed = false
        for (const [id, entry] of this._nodes) {
            if (entry.expiresAt <= now) {
                this._nodes.delete(id)
                changed = true
            }
        }
        return changed
    }

    private _snapshot(): NodeInfo[] {
        return [...this._nodes.values()].map((e) => e.node)
    }

    private _notify(): void {
        const snapshot = this._snapshot()
        for (const w of [...this._watchers]) w(snapshot)
    }

    async register(node: NodeInfo, ttlMs: number): Promise<void> {
        this._nodes.set(node.id, { node, expiresAt: this._clock.now() + ttlMs })
        this._notify()
    }

    async deregister(nodeId: string): Promise<void> {
        if (this._nodes.delete(nodeId)) this._notify()
    }

    async list(): Promise<NodeInfo[]> {
        if (this._prune()) this._notify()
        return this._snapshot()
    }

    watch(callback: (nodes: NodeInfo[]) => void): () => void {
        this._watchers.add(callback)
        return () => {
            this._watchers.delete(callback)
        }
    }
}
