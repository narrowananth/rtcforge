import {
    MessageType,
    PeerEvent,
    RoomEvent,
    ServerEvent,
    SignalingServer,
} from '@rtcforge/signaling'
import type { Peer } from '@rtcforge/signaling'

const PORT = 3005

type StrokeRecord = { type: string; data: unknown }

const server = new SignalingServer({ port: PORT })

server.on(ServerEvent.RoomCreated, (room) => {
    console.log(`[room] created: ${room.id}`)

    const strokes: StrokeRecord[] = []

    function wirePeer(peer: Peer): void {
        // Send current whiteboard state to the newly joined peer
        peer.send({
            type: MessageType.Broadcast,
            from: 'server',
            channel: 'whiteboard',
            data: { type: 'sync', strokes: [...strokes] },
            ts: Date.now(),
        })

        // Listen for whiteboard broadcast events from this peer
        peer.on(PeerEvent.Broadcast, (channel: string, data: unknown) => {
            if (channel !== 'whiteboard') return

            const payload = data as { type?: string; [k: string]: unknown }

            if (payload.type === 'draw' || payload.type === 'erase') {
                strokes.push({ type: payload.type, data })
            } else if (payload.type === 'clear') {
                strokes.length = 0
            }
            // 'cursor' events are not persisted

            // Relay to every other peer in the room
            for (const other of room.getPeers()) {
                if (other.id === peer.id) continue
                other.send({
                    type: MessageType.Broadcast,
                    from: peer.id,
                    channel: 'whiteboard',
                    data,
                    ts: Date.now(),
                })
            }
        })
    }

    // Wire peers already in the room when it was created
    for (const peer of room.getPeers()) {
        wirePeer(peer)
    }

    // Wire each new peer as they join
    room.on(RoomEvent.PeerJoined, (peer) => {
        console.log(`[room:${room.id}] ${peer.id} joined`)
        wirePeer(peer)
    })

    room.on(RoomEvent.PeerLeft, (peer) => {
        console.log(`[room:${room.id}] ${peer.id} left`)
    })

    room.on(RoomEvent.Closed, () => {
        console.log(`[room:${room.id}] closed`)
        strokes.length = 0
    })
})

server.on(ServerEvent.Error, (err) => {
    console.error('[server] error:', err)
})

await server.start()
console.log(`Signaling server running on ws://localhost:${PORT}`)
console.log('Press Ctrl+C to stop.\n')

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
        console.log(`\n[server] ${sig} received — shutting down`)
        await server.stop()
        process.exit(0)
    })
}
