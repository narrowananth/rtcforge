import { RoomEvent, ServerEvent, SignalingServer } from '@rtcforge/signaling'

const PORT = 3001

const server = new SignalingServer({ port: PORT })

server.on(ServerEvent.RoomCreated, (room) => {
    console.log(`[room] created: ${room.id}`)

    room.on(RoomEvent.PeerJoined, (peer) => {
        console.log(`[room:${room.id}] peer joined: ${peer.id} (${peer.role})`)
    })

    room.on(RoomEvent.PeerLeft, (peer) => {
        console.log(`[room:${room.id}] peer left: ${peer.id}`)
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
