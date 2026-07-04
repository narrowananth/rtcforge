// Browser client entry driven by the E2E specs. Uses the *published* browser SDK
// exactly as an app would, and exposes a tiny imperative API on window so the
// Playwright test can join rooms and observe events across two browser contexts.
import { ClientEvent, RTCForgeClient, RoomEvent } from 'rtcforge-sdk'

const received = []

window.rtcforge = {
    received,
    async join(signalUrl, roomId, peerId) {
        const client = new RTCForgeClient({ serverUrl: signalUrl, peerId, reconnect: true })
        window.__client = client
        // Register client-lifecycle handlers *before* joining so the initial
        // Connected (which fires during joinRoom) is captured, not only reconnects.
        client.on(ClientEvent.Reconnecting, () => received.push({ type: 'reconnecting' }))
        client.on(ClientEvent.Connected, () => received.push({ type: 'connected' }))
        const room = await client.joinRoom(roomId)
        window.__room = room
        room.on(RoomEvent.PeerJoined, (id) => received.push({ type: 'peer-joined', id }))
        room.on(RoomEvent.PeerLeft, (id) => received.push({ type: 'peer-left', id }))
        // A single "broadcast" event carries (from, channel, data); filter by channel.
        room.on(RoomEvent.Broadcast, (from, channel, msg) => {
            if (channel === 'chat') received.push({ type: 'chat', from, msg })
        })
        return { peers: room.peers }
    },
    broadcast(channel, payload) {
        window.__room.broadcast(channel, payload)
    },
}
