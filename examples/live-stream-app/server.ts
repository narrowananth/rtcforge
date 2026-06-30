import {
    CascadeBridge,
    type CascadePipeInterface,
    CascadeTree,
    CascadeTreeEvent,
    SfuCluster,
    SfuNode,
    planCascadeTree,
} from '@rtcforge/sfu'
import { RoomEvent, ServerEvent, SignalingServer } from '@rtcforge/signaling'
import type { AuthPayload, Peer } from '@rtcforge/signaling'

const PORT = 3004
// Per-room cap on REAL WebSocket viewers this demo process accepts. The cascade
// tree below plans fan-out for far larger audiences (it sizes the relay tree;
// it does not open sockets here).
const MAX_VIEWERS = 50

// ── Broadcast fan-out tree (1 broadcaster → millions of viewers) ────────────────
//
// A flat SFU melts when one origin must feed every edge. `CascadeTree` lays out a
// log-depth relay tree (origin → relay tiers → edge nodes → viewers) over the SFU
// fleet and self-heals when a node dies. `CascadeBridge` turns each parent→child
// link into a real RTP pipe by calling your `SfuMediaInterface.pipeLink`, which
// runs `MediaRouter.pipeProducerTo` on the SFU host.
//
// This demo builds a synthetic edge fleet so you can watch the tree shape; in
// production the fleet is gossip-discovered (see sfu-app) and each edge is a real
// SFU host process.

const VIEWERS_PER_EDGE = 1000
const FANOUT = 8

const cluster = new SfuCluster()
cluster.addNode(new SfuNode('origin', 'us-east', { capacity: VIEWERS_PER_EDGE }))
for (let i = 0; i < 1200; i++) {
    cluster.addNode(new SfuNode(`edge-${i}`, 'us-east', { capacity: VIEWERS_PER_EDGE }))
}

// Your SFU host adapter: pipeLink moves RTP between two hosts via pipeProducerTo.
const mediaAdapter: CascadePipeInterface = {
    pipeLink: (_roomId, _from, _to) => {
        // Real host: mediaRouter.pipeProducerTo({ producer, targetRouter }) to relay
        // the broadcaster's track from the `from` host down to the `to` host.
    },
    unpipeLink: (_roomId, _from, _to) => {
        // Real host: close the piped producer/consumer for this link.
    },
}

const cascade = new CascadeTree(cluster, { fanout: FANOUT, viewersPerNode: VIEWERS_PER_EDGE })
new CascadeBridge(cascade, mediaAdapter).attach()

cascade.on(CascadeTreeEvent.TreeBuilt, (roomId, plan) => {
    console.log(
        `[cascade:${roomId}] tree built — ${plan.tiers} tiers, ${plan.edges.length} edges, ` +
            `${plan.links.length} pipe links, served ${plan.servedViewers}/${plan.servedViewers + plan.unmetViewers}`,
    )
})
cascade.on(CascadeTreeEvent.CapacityShortfall, (roomId, unmet) => {
    console.warn(`[cascade:${roomId}] capacity shortfall: ${unmet} viewers unserved — add edges`)
})

// Sanity-check the headline number at startup: 1M viewers on this fleet shape.
{
    const m = planCascadeTree({
        originId: 'origin',
        viewerCount: 1_000_000,
        fanout: FANOUT,
        viewersPerNode: VIEWERS_PER_EDGE,
        availableNodeIds: cluster.nodes.map((n) => n.id),
    })
    console.log(
        `[cascade] 1M-viewer plan: ${m.tiers} tiers, ${m.edges.length} edges, served ${m.servedViewers}, unmet ${m.unmetViewers}`,
    )
}

// Simple sliding-window rate limiter: max 20 auth attempts per roomId per second
const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 1_000

function checkRateLimit(roomId: string): boolean {
    const now = Date.now()
    const times = rateLimitMap.get(roomId) ?? []
    const recent = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    recent.push(now)
    rateLimitMap.set(roomId, recent)
    return recent.length <= RATE_LIMIT_MAX
}

async function auth(token: string): Promise<AuthPayload> {
    let decoded: unknown
    try {
        decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    } catch {
        throw new Error('Invalid auth token')
    }

    if (
        typeof decoded !== 'object' ||
        decoded === null ||
        typeof (decoded as Record<string, unknown>).roomId !== 'string' ||
        typeof (decoded as Record<string, unknown>).peerId !== 'string' ||
        typeof (decoded as Record<string, unknown>).role !== 'string'
    ) {
        throw new Error('Invalid auth payload')
    }

    const { roomId, peerId, role } = decoded as { roomId: string; peerId: string; role: string }

    if (role !== 'host' && role !== 'viewer') {
        throw new Error('Invalid role: must be host or viewer')
    }

    if (!checkRateLimit(roomId)) {
        throw new Error('Rate limit exceeded')
    }

    return { roomId, peerId, role } as AuthPayload
}

const server = new SignalingServer({ port: PORT, auth })

server.on(ServerEvent.RoomCreated, (room) => {
    console.log(`[room] created: ${room.id}`)

    let hostPeerId: string | null = null
    const viewers = new Set<string>()

    const onPeerJoined = (peer: Peer) => {
        if (peer.role === 'host') {
            if (hostPeerId === null) {
                hostPeerId = peer.id
                console.log(`[room:${room.id}] host set: ${peer.id}`)
                // Broadcaster is live → lay out the fan-out tree for the expected
                // audience. The host's origin SFU ingests; edges relay to viewers.
                // (Size to taste; here we show a 250k-viewer layout.)
                cascade.build(room.id, 'origin', 250_000)
            }
        } else if (peer.role === 'viewer') {
            if (viewers.size >= MAX_VIEWERS) {
                console.log(
                    `[room:${room.id}] viewer limit reached (${MAX_VIEWERS}), kicking ${peer.id}`,
                )
                room.kickPeer(peer.id, 'Viewer limit reached')
                return
            }
            viewers.add(peer.id)
            console.log(`[room:${room.id}] viewer joined: ${peer.id} (viewers: ${viewers.size})`)
        }
    }
    room.on(RoomEvent.PeerJoined, onPeerJoined)
    // The founding peer's PeerJoined fired synchronously during room creation, before this
    // handler registered its listener — replay current peers so the founding host (and the
    // cascade build it triggers) is not skipped.
    for (const peer of room.getPeers()) onPeerJoined(peer)

    room.on(RoomEvent.PeerLeft, (peer) => {
        if (peer.id === hostPeerId) {
            console.log(`[room:${room.id}] host left: ${peer.id} — kicking all viewers`)
            for (const viewerId of [...viewers]) {
                room.kickPeer(viewerId, 'Host disconnected')
            }
            viewers.clear()
            hostPeerId = null
            cascade.detach(room.id)
            console.log(`[room:${room.id}] all viewers cleared — cascade tree torn down`)
        } else if (viewers.has(peer.id)) {
            viewers.delete(peer.id)
            console.log(`[room:${room.id}] viewer left: ${peer.id} (viewers: ${viewers.size})`)
        }
    })

    room.on(RoomEvent.Closed, () => {
        cascade.detach(room.id)
        console.log(`[room:${room.id}] closed — cascade tree torn down`)
    })
})

server.on(ServerEvent.Error, (err) => {
    console.error('[server] error:', err)
})

await server.start()
console.log(`Live stream signaling server running on ws://localhost:${PORT}`)
console.log('Press Ctrl+C to stop.\n')

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
        console.log(`\n[server] ${sig} received — shutting down`)
        await server.stop()
        process.exit(0)
    })
}
