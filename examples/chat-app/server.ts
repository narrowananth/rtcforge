import { ChatService, ChatServiceEvent, PresenceEvent, PresenceService } from '@rtcforge/chat'
import { RoomEvent, ServerEvent, SignalingServer } from '@rtcforge/signaling'

const PORT = 3001

const server = new SignalingServer({ port: PORT })

server.on(ServerEvent.RoomCreated, (room) => {
    console.log(`[room] created: ${room.id}`)

    const chat = new ChatService(room)
    const presence = new PresenceService(room)

    chat.on(ChatServiceEvent.Message, (msg) => {
        const mode =
            msg.to === undefined
                ? 'broadcast'
                : typeof msg.to === 'string'
                  ? `dm→${msg.to}`
                  : `group→[${msg.to.join(',')}]`
        console.log(`[room:${room.id}] <${msg.from}> [${mode}] ${msg.text ?? '(attachment)'}`)
    })

    chat.on(ChatServiceEvent.Edited, (id, _text, _editedAt, by) => {
        console.log(`[room:${room.id}] ${by} edited message ${id}`)
    })

    chat.on(ChatServiceEvent.Deleted, (id, by) => {
        console.log(`[room:${room.id}] ${by} deleted message ${id}`)
    })

    presence.on(PresenceEvent.Online, (peerId) => {
        console.log(`[room:${room.id}] ${peerId} is online (${presence.getOnline().length} total)`)
    })

    presence.on(PresenceEvent.Offline, (peerId) => {
        console.log(`[room:${room.id}] ${peerId} went offline`)
    })

    room.on(RoomEvent.PeerJoined, (peer) => {
        console.log(`[room:${room.id}] ${peer.id} joined`)
    })

    room.on(RoomEvent.PeerLeft, (peer) => {
        console.log(`[room:${room.id}] ${peer.id} left`)
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
