import { MediaService } from '@rtcforge/media'
import type { Producer } from '@rtcforge/media'
import {
    CascadingRouter,
    CascadingRouterEvent,
    SfuCluster,
    SfuClusterEvent,
    SfuNode,
    SfuNodeEvent,
    SimpleBandwidthEstimator,
} from '@rtcforge/sfu'
import { RoomEvent, ServerEvent, SignalingServer } from '@rtcforge/signaling'

const PORT = 3006

// ── SFU cluster ───────────────────────────────────────────────────────────────

const bwEstimator = new SimpleBandwidthEstimator()

const cluster = new SfuCluster({
    onRebalance: (fromNodeId, reason) => {
        console.log(`\n[cluster] rebalancing from ${fromNodeId} (${reason})`)
    },
})
const router = new CascadingRouter(cluster)
const mediaService = new MediaService()

const nodeUsEast = new SfuNode('sfu-us-east-1', 'us-east', { capacity: 500 })
const nodeEuWest = new SfuNode('sfu-eu-west-1', 'eu-west', { capacity: 500 })
const nodeApSouth = new SfuNode('sfu-ap-south-1', 'ap-south', { capacity: 500 })

cluster.addNode(nodeUsEast)
cluster.addNode(nodeEuWest)
cluster.addNode(nodeApSouth)

cluster.on(SfuClusterEvent.NodeAdded, (node) => {
    console.log(`[cluster] node added: ${node.id} (${node.region})`)
})

cluster.on(SfuClusterEvent.Overloaded, () => {
    console.warn('[cluster] ALL nodes overloaded!')
})

cluster.on(SfuClusterEvent.NodeRemoved, (node) => {
    console.log(`[cluster] node removed: ${node.id}`)
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

router.on(CascadingRouterEvent.CascadeDropped, (roomId, node) => {
    console.log(`[router] cascade dropped: room "${roomId}" node ${node.id}`)
})

// ── Simulate node load changes ────────────────────────────────────────────────

let simRooms = 0

function simulateLoad() {
    simRooms++
    nodeUsEast.reportLoad(simRooms * 12)
    nodeEuWest.reportLoad(simRooms * 8)
    nodeApSouth.reportLoad(simRooms * 5)
}

// Fail us-east after 45 seconds, recover after 30 more seconds
setTimeout(() => {
    console.log('\n[sim] Simulating sfu-us-east-1 failure...')
    nodeUsEast.markFailed()
}, 45_000)

setTimeout(() => {
    console.log('\n[sim] sfu-us-east-1 recovered')
    nodeUsEast.markRecovered()
}, 75_000)

setTimeout(() => {
    console.log('\n[sim] Draining sfu-eu-west-1 for maintenance...')
    void nodeEuWest.drain()
}, 90_000)

setTimeout(() => {
    console.log('\n[sim] sfu-eu-west-1 drain complete — removing node')
    cluster.removeNode(nodeEuWest.id)
}, 105_000)

nodeUsEast.on(SfuNodeEvent.Failed, () => console.warn(`[node:${nodeUsEast.id}] FAILED`))
nodeUsEast.on(SfuNodeEvent.Recovered, () => console.log(`[node:${nodeUsEast.id}] recovered`))
nodeUsEast.on(SfuNodeEvent.Overloaded, () =>
    console.warn(`[node:${nodeUsEast.id}] overloaded (load=${nodeUsEast.load})`),
)

nodeEuWest.on(SfuNodeEvent.Draining, () => console.log(`[node:${nodeEuWest.id}] draining`))
nodeEuWest.on(SfuNodeEvent.Drained, () => console.log(`[node:${nodeEuWest.id}] drained`))

// ── Signaling server ──────────────────────────────────────────────────────────

const server = new SignalingServer({ port: PORT })

server.on(ServerEvent.RoomCreated, (room) => {
    console.log(`\n[room] created: ${room.id}`)

    // Assign room to best SFU node
    const sfuNode = router.attachRoom(room.id)
    console.log(`[room:${room.id}] SFU node: ${sfuNode.id} (load: ${sfuNode.load})`)

    // Attach media plane
    const mediaRouter = mediaService.attachRoom(room)
    console.log(`[room:${room.id}] MediaRouter attached (routers: ${mediaService.routerCount})`)

    // Track producers per peer for cross-subscription
    const peerProducers = new Map<string, { audio: Producer; video: Producer }>()

    room.on(RoomEvent.PeerJoined, (peer) => {
        console.log(`[room:${room.id}] peer joined: ${peer.id}`)
        simulateLoad()

        const quality = bwEstimator.estimate({ bitrate: 1_500_000, packetLoss: 0.01, rtt: 80 })
        console.log(`[room:${room.id}] bandwidth quality estimate: ${quality}`)

        // Create producers for the new peer
        const audio = mediaRouter.createProducer(peer.id, 'audio')
        const video = mediaRouter.createProducer(peer.id, 'video')
        peerProducers.set(peer.id, { audio, video })

        console.log(
            `[room:${room.id}] producers: ${peer.id} → audio:${audio.id}, video:${video.id}`,
        )

        // Cross-subscribe: new peer subscribes to all existing peers
        // Existing peers subscribe to new peer
        for (const [existingId, producers] of peerProducers) {
            if (existingId === peer.id) continue

            // New peer subscribes to existing peer
            const cAudio = mediaRouter.createConsumer(peer.id, producers.audio.id)
            const cVideo = mediaRouter.createConsumer(peer.id, producers.video.id)
            console.log(
                `[room:${room.id}] consumer: ${peer.id} ← ${existingId} (${cAudio.id}, ${cVideo.id})`,
            )

            // Existing peer subscribes to new peer
            const cAudioRev = mediaRouter.createConsumer(existingId, audio.id)
            const cVideoRev = mediaRouter.createConsumer(existingId, video.id)
            console.log(
                `[room:${room.id}] consumer: ${existingId} ← ${peer.id} (${cAudioRev.id}, ${cVideoRev.id})`,
            )
        }

        sfuNode.reportLoad(sfuNode.load + 2)
        console.log(
            `[room:${room.id}] producers: ${mediaRouter.producerCount}, consumers: ${mediaRouter.consumerCount}`,
        )
    })

    room.on(RoomEvent.PeerLeft, (peer) => {
        peerProducers.delete(peer.id)
        sfuNode.reportLoad(Math.max(0, sfuNode.load - 2))
        console.log(
            `[room:${room.id}] peer left: ${peer.id} (producers: ${mediaRouter.producerCount}, consumers: ${mediaRouter.consumerCount})`,
        )
    })

    room.on(RoomEvent.Closed, () => {
        router.detachRoom(room.id)
        console.log(`[room:${room.id}] closed — SFU detached`)
    })
})

server.on(ServerEvent.Error, (err) => {
    console.error('[server] error:', err)
})

await server.start()

console.log(`SFU app server running on ws://localhost:${PORT}`)
console.log('Open http://localhost:5178 to use the app')
console.log(
    `Cluster: ${cluster.nodes.length} nodes (${cluster.nodes.map((n) => n.region).join(', ')})`,
)
console.log('Press Ctrl+C to stop.\n')

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
        console.log(`\n[server] ${sig} — shutting down`)
        mediaService.closeAll()
        await server.stop()
        process.exit(0)
    })
}
