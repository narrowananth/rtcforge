import { type Clock, systemClock } from './Clock.js'
import type { Membership, NodeInfo } from './Membership.js'

export interface GossipEntry {
    id: string
    address?: string
    region?: string
    metadata?: Record<string, string>
    incarnation: number
    alive: boolean
}

export interface GossipMessage {
    from: string
    members: GossipEntry[]
}

export interface GossipTransport {
    readonly address: string
    send(toAddress: string, msg: GossipMessage): void
    onReceive(handler: (msg: GossipMessage) => void): void
    close?(): void
}

export interface GossipMembershipOptions {
    seeds?: string[]
    clock?: Clock
    gossipIntervalMs?: number
    fanout?: number
    deadTimeoutMs?: number
    tombstoneMs?: number
}

interface MemberRecord {
    info: NodeInfo
    address?: string
    incarnation: number
    alive: boolean
    lastSeen: number
}

/**
 * Decentralized {@link Membership} that spreads node state across a cluster with
 * SWIM-style anti-entropy gossip — no Redis/etcd, no central coordinator.
 *
 * @remarks
 * Each node periodically gossips its view (self + known peers, each tagged with a
 * monotonic incarnation and alive flag) to a random fanout of peers over a
 * {@link GossipTransport}. Newer incarnations win; at equal incarnation a dead
 * claim overrides a live one, and a node refutes a false death report by
 * advancing its own incarnation. Peers not heard from within `deadTimeoutMs` are
 * marked dead and eventually tombstone-GC'd. Pair with {@link MembershipReconciler}
 * to react to joins/leaves. This is AP (available under partition) with no
 * quorum, so treat ownership derived from it as advisory unless fenced.
 */
export class GossipMembership implements Membership {
    private readonly _self: NodeInfo
    private readonly _transport: GossipTransport
    private readonly _clock: Clock
    private readonly _intervalMs: number
    private readonly _fanout: number
    private readonly _deadMs: number
    private readonly _tombstoneMs: number
    private readonly _seeds: Set<string>
    private readonly _members = new Map<string, MemberRecord>()
    private readonly _watchers = new Set<(nodes: NodeInfo[]) => void>()
    private _timer: unknown
    private _running = false

    constructor(self: NodeInfo, transport: GossipTransport, opts: GossipMembershipOptions = {}) {
        this._self = self
        this._transport = transport
        this._clock = opts.clock ?? systemClock
        this._intervalMs = opts.gossipIntervalMs ?? 200
        this._fanout = opts.fanout ?? 3
        this._deadMs = opts.deadTimeoutMs ?? this._intervalMs * 5
        this._tombstoneMs = opts.tombstoneMs ?? this._deadMs * 10
        this._seeds = new Set(opts.seeds ?? [])
        this._members.set(self.id, {
            info: self,
            address: transport.address,
            incarnation: 0,
            alive: true,
            lastSeen: this._clock.now(),
        })
    }

    start(): void {
        if (this._running) return
        this._running = true
        this._transport.onReceive((msg) => this._onReceive(msg))
        this._scheduleTick()
    }

    stop(): void {
        if (!this._running) return
        this._running = false
        if (this._timer !== undefined) this._clock.clearTimeout(this._timer)
        const self = this._members.get(this._self.id)
        if (self) {
            self.alive = false
            self.incarnation += 1
            this._gossip()
        }
        this._transport.close?.()
    }

    async register(node: NodeInfo, _ttlMs?: number): Promise<void> {
        if (node.id === this._self.id) {
            const self = this._members.get(this._self.id)
            if (self) {
                self.info = node
                self.alive = true
                self.incarnation += 1
                self.lastSeen = this._clock.now()
            }
            // Notify local watchers of a self re-register (e.g. changed
            // region/metadata), matching deregister's behavior.
            this._notify()
            this._gossip()
            return
        }

        if (node.address) this._seeds.add(node.address)
    }

    async deregister(nodeId: string): Promise<void> {
        const rec = this._members.get(nodeId)
        if (!rec || !rec.alive) return
        rec.alive = false

        rec.incarnation += 1
        this._notify()
        this._gossip()
    }

    async list(): Promise<NodeInfo[]> {
        this._sweep()
        return this._aliveInfos()
    }

    watch(callback: (nodes: NodeInfo[]) => void): () => void {
        this._watchers.add(callback)
        return () => {
            this._watchers.delete(callback)
        }
    }

    private _scheduleTick(): void {
        this._timer = this._clock.setTimeout(() => {
            if (!this._running) return
            this._tick()
            this._scheduleTick()
        }, this._intervalMs)
    }

    private _tick(): void {
        const self = this._members.get(this._self.id)
        if (self) {
            self.incarnation += 1
            self.lastSeen = this._clock.now()
        }
        this._sweep()
        this._gossip()
    }

    private _gossip(): void {
        const digest: GossipEntry[] = []
        for (const rec of this._members.values()) {
            digest.push({
                id: rec.info.id,
                address: rec.address,
                region: rec.info.region,
                metadata: rec.info.metadata,
                incarnation: rec.incarnation,
                alive: rec.alive,
            })
        }
        const msg: GossipMessage = { from: this._self.id, members: digest }

        const targets = this._pickTargets()
        for (const addr of targets) this._transport.send(addr, msg)
    }

    private _pickTargets(): string[] {
        const addrs = new Set<string>()
        for (const rec of this._members.values()) {
            if (rec.info.id === this._self.id || !rec.alive || !rec.address) continue
            addrs.add(rec.address)
        }
        for (const s of this._seeds) if (s !== this._transport.address) addrs.add(s)

        const all = [...addrs]
        if (all.length <= this._fanout) return all
        const out: string[] = []
        const pool = all.slice()
        for (let i = 0; i < this._fanout && pool.length > 0; i++) {
            const idx = Math.floor(Math.random() * pool.length)
            out.push(pool[idx])
            pool.splice(idx, 1)
        }
        return out
    }

    private _onReceive(msg: GossipMessage): void {
        let changed = false
        for (const entry of msg.members) changed = this._merge(entry) || changed
        if (changed) this._notify()
    }

    private _merge(entry: GossipEntry): boolean {
        if (entry.id === this._self.id) {
            const self = this._members.get(this._self.id)
            if (!self) return false
            const mustRefute =
                entry.incarnation > self.incarnation ||
                (entry.incarnation === self.incarnation && !entry.alive)
            if (mustRefute) {
                self.incarnation = entry.incarnation + 1
                self.alive = true
                self.lastSeen = this._clock.now()
            }
            return false
        }

        const known = this._members.get(entry.id)
        if (!known) {
            this._members.set(entry.id, {
                info: {
                    id: entry.id,
                    region: entry.region,
                    address: entry.address,
                    metadata: entry.metadata,
                },
                address: entry.address,
                incarnation: entry.incarnation,
                alive: entry.alive,
                lastSeen: this._clock.now(),
            })
            if (entry.address) this._seeds.add(entry.address)
            return entry.alive
        }

        // SWIM precedence: at equal incarnation a dead claim overrides a live
        // one. A departed node can no longer advance its own incarnation, so
        // without this its `deregister`/timeout death is ignored and the stale
        // live entry lingers (or revives). A genuinely live node still refutes
        // by broadcasting a higher incarnation, which the block below applies.
        if (entry.incarnation === known.incarnation && !entry.alive && known.alive) {
            known.alive = false
            known.lastSeen = this._clock.now()
            return true
        }

        if (entry.incarnation > known.incarnation) {
            const wasAlive = known.alive
            known.incarnation = entry.incarnation
            known.alive = entry.alive
            known.info = {
                id: entry.id,
                region: entry.region,
                address: entry.address,
                metadata: entry.metadata,
            }
            known.address = entry.address
            known.lastSeen = this._clock.now()
            return wasAlive !== entry.alive
        }
        return false
    }

    private _sweep(): void {
        const now = this._clock.now()
        let changed = false
        for (const [id, rec] of this._members) {
            if (id === this._self.id) continue
            if (rec.alive) {
                if (now - rec.lastSeen > this._deadMs) {
                    rec.alive = false
                    rec.incarnation += 1
                    changed = true
                }
            } else if (now - rec.lastSeen > this._tombstoneMs) {
                this._members.delete(id)
            }
        }
        if (changed) this._notify()
    }

    private _aliveInfos(): NodeInfo[] {
        const out: NodeInfo[] = []
        for (const rec of this._members.values()) if (rec.alive) out.push(rec.info)
        return out
    }

    private _notify(): void {
        const snapshot = this._aliveInfos()
        for (const w of [...this._watchers]) w(snapshot)
    }
}

export class GossipNetwork {
    private readonly _handlers = new Map<string, (msg: GossipMessage) => void>()
    private readonly _partitioned = new Set<string>()

    register(address: string, handler: (msg: GossipMessage) => void): void {
        this._handlers.set(address, handler)
    }

    unregister(address: string): void {
        this._handlers.delete(address)
    }

    deliver(from: string, to: string, msg: GossipMessage): void {
        if (this._partitioned.has(from) || this._partitioned.has(to)) return
        this._handlers.get(to)?.(msg)
    }

    partition(address: string): void {
        this._partitioned.add(address)
    }

    heal(address: string): void {
        this._partitioned.delete(address)
    }
}

export class InMemoryGossipTransport implements GossipTransport {
    private _handler?: (msg: GossipMessage) => void

    constructor(
        readonly address: string,
        private readonly _network: GossipNetwork,
    ) {
        this._network.register(address, (msg) => this._handler?.(msg))
    }

    send(toAddress: string, msg: GossipMessage): void {
        this._network.deliver(this.address, toAddress, msg)
    }

    onReceive(handler: (msg: GossipMessage) => void): void {
        this._handler = handler
    }

    close(): void {
        this._network.unregister(this.address)
    }
}
