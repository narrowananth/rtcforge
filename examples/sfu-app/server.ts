import {
    GossipMembership,
    GossipNetwork,
    InMemoryGossipTransport,
    type NodeInfo,
} from '@rtcforge/core'
import { MediaService } from '@rtcforge/media'
import {
    CascadingRouter,
    CascadingRouterEvent,
    HashRingStrategy,
    SfuCluster,
    SfuClusterEvent,
    SfuNode,
    SfuNodeEvent,
    SimpleBandwidthEstimator,
} from '@rtcforge/sfu'
import { RoomEvent, RoomRouter, ServerEvent, SignalingServer } from '@rtcforge/signaling'
import type { Peer } from '@rtcforge/signaling'

const PORT = 3006

// Parse an advertised capacity string, honoring a legitimately-advertised 0
// (a full/draining node) and only falling back to the default when the value
// is missing or non-numeric. `Number(x) || default` would wrongly map 0 → default.
function parseCapacity(raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
}

// ── Shared-nothing fleet (gossip-discovered, NO Redis/etcd) ─────────────────────
//
// Each SFU host runs a GossipMembership and discovers the others peer-to-peer
// (SWIM). In production every host lives in its own process and the wire is
// `UdpGossipTransport` from `@rtcforge/adapter-udp`:
//
//     import { UdpGossipTransport } from '@rtcforge/adapter-udp'
//     const transport = new UdpGossipTransport({ host: '0.0.0.0', port: 7946 })
//
// Here a single process simulates the 3-host fleet with InMemoryGossipTransport
// over one shared GossipNetwork bus — same Membership API, no sockets.

const net = new GossipNetwork()

const FLEET = [
    { id: 'sfu-us-east-1', region: 'us-east', address: 'udp://10.0.0.1:7946', capacity: 500 },
    { id: 'sfu-eu-west-1', region: 'eu-west', address: 'udp://10.0.0.2:7946', capacity: 500 },
    { id: 'sfu-ap-south-1', region: 'ap-south', address: 'udp://10.0.0.3:7946', capacity: 500 },
]

const allAddresses = FLEET.map((h) => h.address)

const members = new Map<string, GossipMembership>()
for (const h of FLEET) {
    const info: NodeInfo = {
        id: h.id,
        region: h.region,
        address: h.address,
        metadata: { capacity: String(h.capacity) },
    }
    const membership = new GossipMembership(info, new InMemoryGossipTransport(h.address, net), {
        seeds: allAddresses.filter((a) => a !== h.address),
        gossipIntervalMs: 150,
    })
    membership.start()
    members.set(h.id, membership)
}

// This process acts as the first host; its gossip view feeds both the SFU
// placement (SfuCluster) and the signaling room router (RoomRouter).
const selfId = FLEET[0].id
const fleetView = members.get(selfId) as GossipMembership

// ── SFU cluster — deterministic placement over the gossip fleet ─────────────────

const bwEstimator = new SimpleBandwidthEstimator()

const cluster = new SfuCluster({
    membership: fleetView, // auto-sync SFU nodes from gossip
    placementStrategy: new HashRingStrategy(), // room→host by consistent hash, capacity-weighted
    nodeFactory: (info) =>
        // each fleet member becomes an SfuNode; capacity weights the hash ring
        new SfuNode(info.id, info.region ?? 'default', {
            capacity: parseCapacity(info.metadata?.capacity, 100),
        }),
    onRebalance: (fromNodeId, reason) => {
        console.log(`\n[cluster] rebalancing from ${fromNodeId} (${reason})`)
    },
})

const router = new CascadingRouter(cluster)
const mediaService = new MediaService()

// RoomRouter shows the signaling-plane sharding: ring.get(roomId) → owner node.
// In a real multi-node deploy you pass `cluster: { selfId, membership }` to
// SignalingServer and it redirects peers to the owner. This single-node demo
// runs without that (so every peer is served locally) and uses a standalone
// RoomRouter purely to PRINT how rooms would shard across the fleet.
const roomRouter = new RoomRouter({ selfId, membership: fleetView })

cluster.on(SfuClusterEvent.NodeAdded, (node) => {
    console.log(`[cluster] node discovered via gossip: ${node.id} (${node.region})`)
})
cluster.on(SfuClusterEvent.NodeRemoved, (node) => {
    console.log(`[cluster] node gone (gossip): ${node.id} — ring rebalanced`)
})
cluster.on(SfuClusterEvent.Overloaded, () => {
    console.warn('[cluster] ALL nodes overloaded!')
})

router.on(CascadingRouterEvent.RoomAssigned, (roomId, node) => {
    console.log(`[router] room "${roomId}" → ${node.id} (${node.region})`)
})
router.on(CascadingRouterEvent.CascadeCreated, (roomId, fromNode, toNode) => {
    console.log(`[router] cascade: room "${roomId}" ${fromNode.id} → ${toNode.id}`)
})
router.on(CascadingRouterEvent.RoomDetached, (roomId) => {
    console.log(`[router] room "${roomId}" detached`)
})

// Print the deterministic room→owner shard table for a few sample room IDs.
function printShardTable(label: string): void {
    const sample = ['team-standup', 'webinar-42', 'support-call', 'class-101', 'townhall']
    console.log(`\n[shard] ${label} — room → owner (signaling) / placement (sfu)`)
    for (const r of sample) {
        const owner = roomRouter.owner(r)
        const placed = cluster.assignNode(undefined, r)
        console.log(`  ${r.padEnd(14)} → signaling=${owner?.id ?? '—'}  sfu=${placed?.id ?? '—'}`)
    }
}

// ── Simulate a gossip-driven failure: deregister a host → ring rebalances ───────

setTimeout(() => {
    console.log('\n[sim] sfu-us-east-1 process dies → stops gossiping...')
    void members.get('sfu-us-east-1')?.deregister('sfu-us-east-1')
    members.get('sfu-us-east-1')?.stop()
    setTimeout(() => printShardTable('after sfu-us-east-1 failure (rebalanced)'), 1_000)
}, 45_000)

// ── Signaling server (single-node demo — serves all rooms locally) ──────────────

const server = new SignalingServer({ port: PORT })

server.on(ServerEvent.RoomCreated, async (room) => {
    console.log(`\n[room] created: ${room.id}`)

    // Where this room shards in the fleet (deterministic, no coordination):
    const owner = roomRouter.owner(room.id)
    console.log(
        `[room:${room.id}] signaling owner: ${owner?.id ?? selfId} @ ${owner?.address ?? 'local'}`,
    )

    // Place the room's SFU on its owner host by consistent hash (room id = key):
    const sfuNode = router.attachRoom(room.id)
    console.log(
        `[room:${room.id}] SFU host: ${sfuNode.id} (${sfuNode.region}, load: ${sfuNode.load})`,
    )

    // Attach the real mediasoup media plane — one Router per room (runs locally
    // in this demo; in production it runs on the owner host above).
    const mediaRouter = await mediaService.attachRoom(room)
    console.log(
        `[room:${room.id}] MediaRouter attached — codecs: ${mediaRouter.rtpCapabilities.codecs?.length ?? 0}`,
    )

    const onPeerJoined = (peer: Peer) => {
        console.log(`[room:${room.id}] peer joined: ${peer.id}`)
        const quality = bwEstimator.estimate({ bitrate: 1_500_000, packetLoss: 0.01, rtt: 80 })
        console.log(`[room:${room.id}] bandwidth quality estimate: ${quality}`)
        sfuNode.reportLoad(sfuNode.load + 2)

        // Real produce/consume is driven by the browser (mediasoup-client) over your
        // app wire protocol against the MediaRouter:
        //   getRtpCapabilities → createWebRtcTransport → connectTransport →
        //   produce / consume → resumeConsumer
    }
    room.on(RoomEvent.PeerJoined, onPeerJoined)
    // The founding peer's PeerJoined fired synchronously during room creation, before this
    // async handler awaited attachRoom and registered the listener — replay current peers so
    // the founder is not skipped.
    for (const peer of room.getPeers()) onPeerJoined(peer)

    room.on(RoomEvent.PeerLeft, (peer) => {
        sfuNode.reportLoad(Math.max(0, sfuNode.load - 2))
        console.log(`[room:${room.id}] peer left: ${peer.id}`)
    })

    room.on(RoomEvent.Closed, () => {
        router.detachRoom(room.id)
        console.log(`[room:${room.id}] closed — SFU detached`)
    })
})

server.on(ServerEvent.Error, (err) => {
    console.error('[server] error:', err)
})

await mediaService.init() // spawn the mediasoup worker pool
await server.start() // accept connections immediately — don't block on gossip

console.log(`SFU app server running on ws://localhost:${PORT}`)
console.log('Open http://localhost:5178 to use the app')

// Let gossip converge, then report the fleet + deterministic shard table.
await new Promise((r) => setTimeout(r, 800))
console.log(
    `Cluster (gossip-discovered): ${cluster.nodes.length} nodes (${cluster.nodes
        .map((n) => n.region)
        .join(', ')})`,
)
printShardTable('initial')
console.log('\nPress Ctrl+C to stop.\n')

const sampleNode = cluster.nodes[0] as SfuNode | undefined
sampleNode?.on(SfuNodeEvent.Overloaded, () =>
    console.warn(`[node:${sampleNode.id}] overloaded (load=${sampleNode.load})`),
)

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
        console.log(`\n[server] ${sig} — shutting down`)
        for (const m of members.values()) m.stop()
        await mediaService.closeAll()
        await server.stop()
        process.exit(0)
    })
}
