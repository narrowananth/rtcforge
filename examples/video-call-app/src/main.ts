import { ClientEvent, MessageType, RTCForgeClient, RoomEvent } from '@rtcforge/sdk'
import type { Room } from '@rtcforge/sdk'

const SIGNALING_URL = 'ws://localhost:3001'
const MAX_LOG_ENTRIES = 100

const joinFormEl = document.getElementById('join-form') as HTMLElement
const roomViewEl = document.getElementById('room-view') as HTMLElement
const peerIdInput = document.getElementById('peer-id') as HTMLInputElement
const roomIdInput = document.getElementById('room-id') as HTMLInputElement
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement
const roomTitle = document.getElementById('room-title') as HTMLElement
const myPeerTag = document.getElementById('my-peer-tag') as HTMLElement
const peersList = document.getElementById('peers-list') as HTMLElement
const signalLogEl = document.getElementById('signal-log') as HTMLElement
const pingAllBtn = document.getElementById('ping-all-btn') as HTMLButtonElement
const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement

let client: RTCForgeClient | null = null
let currentRoom: Room | null = null

peersList.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('button[data-peer-id]')
    if (!btn) return
    const peerId = btn.getAttribute('data-peer-id')
    if (!peerId) return
    sendPingTo(peerId)
})

joinBtn.addEventListener('click', async () => {
    const peerId = peerIdInput.value.trim()
    const roomId = roomIdInput.value.trim()
    if (!peerId || !roomId) return

    joinBtn.disabled = true
    joinBtn.textContent = 'Connecting…'

    try {
        client = new RTCForgeClient({
            serverUrl: `${SIGNALING_URL}?peerId=${encodeURIComponent(peerId)}`,
            reconnect: false,
        })

        const room = await client.joinRoom(roomId)
        currentRoom = room

        joinFormEl.style.display = 'none'
        roomViewEl.style.display = 'block'
        roomTitle.textContent = `Room: ${room.id}`
        myPeerTag.textContent = `You: ${room.localPeerId}`

        renderPeers()
        log('sys', `Joined room "${room.id}" as ${room.localPeerId}`)

        room.on(MessageType.PeerJoined, (id) => {
            log('sys', `${id} joined`)
            renderPeers()
        })

        room.on(MessageType.PeerLeft, (id) => {
            log('sys', `${id} left`)
            renderPeers()
        })

        room.on(MessageType.Signal, (from, data) => {
            log('in', `signal from ${from}: ${JSON.stringify(data)}`)
        })

        room.on(RoomEvent.Closed, () => {
            log('sys', 'Room closed')
        })

        client.on(ClientEvent.Disconnected, (code, reason) => {
            log('sys', `Disconnected (${code}: ${reason})`)
        })
    } catch (err) {
        log('sys', `Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
        joinBtn.disabled = false
        joinBtn.textContent = 'Join Room'
    }
})

pingAllBtn.addEventListener('click', () => {
    const room = currentRoom
    if (!room) return
    const others = room.peers.filter((p) => p !== room.localPeerId)
    if (others.length === 0) {
        log('sys', 'No peers to ping')
        return
    }
    const ts = Date.now()
    for (const peerId of others) {
        sendPingTo(peerId, ts)
    }
})

leaveBtn.addEventListener('click', async () => {
    currentRoom?.removeAllListeners()
    client?.removeAllListeners()
    await client?.leave()
    client = null
    currentRoom = null
    joinFormEl.style.display = 'block'
    roomViewEl.style.display = 'none'
    renderPeers()
    signalLogEl.innerHTML = ''
})

function sendPingTo(peerId: string, ts = Date.now()): void {
    const room = currentRoom
    if (!room) return
    const payload = { type: 'ping', from: room.localPeerId, ts }
    room.sendSignal(peerId, payload)
    log('out', `signal to ${peerId}: ${JSON.stringify(payload)}`)
}

function renderPeers(): void {
    const room = currentRoom
    peersList.innerHTML = ''
    const others = room ? room.peers.filter((p) => p !== room.localPeerId) : []
    if (others.length === 0) {
        const li = document.createElement('li')
        li.className = 'empty'
        li.textContent = 'No other peers yet'
        peersList.appendChild(li)
        return
    }
    for (const id of others) {
        const li = document.createElement('li')
        const span = document.createElement('span')
        span.textContent = id
        const btn = document.createElement('button')
        btn.textContent = 'Ping'
        btn.dataset.peerId = id
        li.appendChild(span)
        li.appendChild(btn)
        peersList.appendChild(li)
    }
}

function log(kind: 'in' | 'out' | 'sys', msg: string): void {
    const entry = document.createElement('div')
    entry.className = `log-entry ${kind}`
    const timeSpan = document.createElement('span')
    timeSpan.className = 'time'
    timeSpan.textContent = new Date().toLocaleTimeString()
    entry.appendChild(timeSpan)
    entry.appendChild(document.createTextNode(msg))
    signalLogEl.prepend(entry)
    if (signalLogEl.children.length > MAX_LOG_ENTRIES) {
        const last = signalLogEl.lastChild
        if (last) signalLogEl.removeChild(last)
    }
}
