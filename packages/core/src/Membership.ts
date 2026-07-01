import { type Clock, systemClock } from './Clock.js'

/**
 * Descriptor for a node participating in cluster membership.
 */
export interface NodeInfo {
    /** Unique node identifier. */
    id: string
    /** Optional geographic or logical region the node belongs to. */
    region?: string
    /** Optional network address other nodes use to reach this one. */
    address?: string
    /** Optional free-form string metadata (e.g. capabilities, version). */
    metadata?: Record<string, string>
}

/**
 * Registry of the nodes currently forming a cluster.
 *
 * @remarks
 * Membership lets components discover peers, register themselves with a heartbeat TTL, and
 * react to nodes joining or leaving. The default in-process implementation is
 * {@link MemoryMembership}; `GossipMembership` provides a decentralized, gossip-based
 * implementation for multi-node deployments. Pair with `MembershipReconciler` to turn
 * membership snapshots into add/remove/update callbacks.
 */
export interface Membership {
    /**
     * Registers (or refreshes) a node with a heartbeat lifetime.
     * @param node - The node to register.
     * @param ttlMs - Lifetime in milliseconds; the node is considered gone if not refreshed within this window.
     */
    register(node: NodeInfo, ttlMs: number): Promise<void>
    /**
     * Removes a node from the registry.
     * @param nodeId - The id of the node to remove.
     */
    deregister(nodeId: string): Promise<void>
    /**
     * Returns a snapshot of the currently live nodes.
     * @returns The live nodes; expired entries are pruned before the snapshot is taken.
     */
    list(): Promise<NodeInfo[]>
    /**
     * Subscribes to membership changes.
     * @param callback - Invoked with the full set of live nodes whenever membership changes.
     * @returns A function that cancels the subscription when called.
     */
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
