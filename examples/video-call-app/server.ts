import { RoomEvent, ServerEvent, SignalingServer } from '@rtcforge/signaling'
import type { AuditEvent, Peer } from '@rtcforge/signaling'

const PORT = 3003

const server = new SignalingServer({
    port: PORT,
    maxPeersPerRoom: 8,
    roomIdleTimeoutMs: 120_000,
    rateLimit: { maxMessagesPerSecond: 20 },
    auditLog: (e: AuditEvent) =>
        console.log(`[audit] ${e.type} peer=${e.peerId ?? '-'} room=${e.roomId}`),
})

server.on(ServerEvent.RoomCreated, (room) => {
    console.log(`[room] created: ${room.id}`)

    const onPeerJoined = (peer: Peer) => {
        console.log(`[room:${room.id}] peer joined: ${peer.id} (${peer.role})`)
    }
    room.on(RoomEvent.PeerJoined, onPeerJoined)
    // The founding peer's PeerJoined fired synchronously during room creation, before this
    // handler registered its listener — replay current peers so the founder is not skipped.
    for (const peer of room.getPeers()) onPeerJoined(peer)

    room.on(RoomEvent.PeerLeft, (peer) => {
        console.log(`[room:${room.id}] peer left: ${peer.id}`)
    })

    room.on(RoomEvent.PeerKicked, (peerId, reason) => {
        console.log(`[room:${room.id}] peer kicked: ${peerId}${reason ? ` (${reason})` : ''}`)
    })

    room.on(RoomEvent.Closed, () => {
        console.log(`[room:${room.id}] closed`)
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
