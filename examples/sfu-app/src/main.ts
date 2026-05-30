import { Call, getUserMedia } from '@rtcforge/media'
import { MessageType, RTCForgeClient, RoomMediaEvent } from '@rtcforge/sdk'
import type { Room } from '@rtcforge/sdk'

const SERVER_URL = 'ws://localhost:3006'

// ── DOM refs ──────────────────────────────────────────────────────────────────

const joinForm = document.getElementById('join-form') as HTMLDivElement
const roomView = document.getElementById('room-view') as HTMLDivElement
const peerIdInput = document.getElementById('peer-id') as HTMLInputElement
const roomIdInput = document.getElementById('room-id') as HTMLInputElement
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement
const roomTitle = document.getElementById('room-title') as HTMLHeadingElement
const sfuTag = document.getElementById('sfu-tag') as HTMLSpanElement
const peerTag = document.getElementById('peer-tag') as HTMLSpanElement
const videoGrid = document.getElementById('video-grid') as HTMLDivElement
const peersList = document.getElementById('peers-list') as HTMLUListElement
const cameraBtn = document.getElementById('camera-btn') as HTMLButtonElement
const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement
const eventLog = document.getElementById('event-log') as HTMLDivElement

// ── State ─────────────────────────────────────────────────────────────────────

let client: RTCForgeClient | null = null
let currentRoom: Room | null = null
let call: Call | null = null
let localStream: MediaStream | null = null
let cameraActive = false
const peerTiles = new Map<string, HTMLDivElement>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string, level: 'info' | 'warn' | 'sfu' = 'info') {
    const entry = document.createElement('div')
    entry.className = `log-entry ${level}`
    const time = new Date().toLocaleTimeString()
    entry.innerHTML = `<span class="time">${time}</span>${msg}`
    eventLog.appendChild(entry)
    eventLog.scrollTop = eventLog.scrollHeight
}

function makeTile(id: string, stream: MediaStream, label: string, cls: string): HTMLDivElement {
    const tile = document.createElement('div')
    tile.className = `video-tile ${cls}`
    tile.dataset.peer = id
    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.muted = cls === 'local'
    video.srcObject = stream
    const lbl = document.createElement('div')
    lbl.className = 'video-label'
    lbl.textContent = label
    tile.appendChild(video)
    tile.appendChild(lbl)
    videoGrid.appendChild(tile)
    return tile
}

function removeTile(id: string) {
    peerTiles.get(id)?.remove()
    peerTiles.delete(id)
}

function renderPeerList(peers: string[], localId: string) {
    peersList.innerHTML = ''
    const others = peers.filter((p) => p !== localId)
    if (others.length === 0) {
        peersList.innerHTML = '<li class="empty">No other peers yet</li>'
        return
    }
    for (const p of others) {
        const li = document.createElement('li')
        li.textContent = p
        peersList.appendChild(li)
    }
}

// ── Join ──────────────────────────────────────────────────────────────────────

joinBtn.addEventListener('click', async () => {
    const peerId = peerIdInput.value.trim()
    const roomId = roomIdInput.value.trim()
    if (!peerId || !roomId) {
        alert('Enter peer ID and room ID')
        return
    }

    joinBtn.disabled = true

    client = new RTCForgeClient({ serverUrl: SERVER_URL, peerId })

    const room: Room | null = await client.joinRoom(roomId).catch((err: unknown) => {
        log(`Connection failed: ${err instanceof Error ? err.message : String(err)}`, 'warn')
        joinBtn.disabled = false
        return null
    })
    if (!room) return
    currentRoom = room

    joinForm.style.display = 'none'
    roomView.style.display = 'block'
    roomTitle.textContent = `Room: ${room.id}`
    sfuTag.textContent = 'SFU-ROUTED'
    peerTag.textContent = peerId

    // Set up call for WebRTC mesh (demo: SFU routing is server-side)
    call = new Call(room)
    room.bindCall(call)

    // Try to start local camera
    try {
        localStream = await getUserMedia({ video: true, audio: true })
        const tile = makeTile('local', localStream, `${peerId} (you)`, 'local')
        peerTiles.set('local', tile)
        for (const track of localStream.getTracks()) call.addTrack(track, localStream)
        cameraActive = true
        cameraBtn.textContent = 'Stop Camera'
        log('Camera started')
    } catch {
        log('Camera unavailable — audio only', 'warn')
    }

    // Remote stream → add video tile
    room.on(RoomMediaEvent.TrackAdded, (track, streams, fromPeerId) => {
        const stream = streams[0]
        if (!stream) return
        if (!peerTiles.has(fromPeerId)) {
            const tile = makeTile(fromPeerId, stream, fromPeerId, 'remote')
            peerTiles.set(fromPeerId, tile)
            log(`Stream from ${fromPeerId}`, 'sfu')
        } else {
            // Add track to existing stream
            const video = peerTiles.get(fromPeerId)?.querySelector('video') as HTMLVideoElement
            const existing = video.srcObject as MediaStream
            existing.addTrack(track)
        }
    })

    room.on(MessageType.PeerJoined, (joinedPeerId) => {
        log(`[SFU] peer joined: ${joinedPeerId}`, 'sfu')
        renderPeerList(room.peers, room.localPeerId)
    })

    room.on(MessageType.PeerLeft, (leftPeerId) => {
        log(`[SFU] peer left: ${leftPeerId}`, 'sfu')
        removeTile(leftPeerId)
        renderPeerList(room.peers, room.localPeerId)
    })

    room.on(MessageType.Kicked, (_pid, reason) => {
        log(`Kicked${reason ? `: ${reason}` : ''}`, 'warn')
        cleanup()
    })

    renderPeerList(room.peers, room.localPeerId)
    log(`Joined room "${room.id}" — server routes via SFU cluster`, 'sfu')
    log(`Peers in room: ${room.peers.length}`)
})

// ── Camera toggle ─────────────────────────────────────────────────────────────

cameraBtn.addEventListener('click', async () => {
    if (!currentRoom || !call) return

    if (cameraActive) {
        if (localStream) {
            for (const t of localStream.getTracks()) t.stop()
        }
        localStream = null
        cameraActive = false
        cameraBtn.textContent = 'Start Camera'
        removeTile('local')
        log('Camera stopped')
    } else {
        try {
            localStream = await getUserMedia({ video: true, audio: true })
            const tile = makeTile('local', localStream, `${peerIdInput.value} (you)`, 'local')
            peerTiles.set('local', tile)
            for (const track of localStream.getTracks()) call.addTrack(track, localStream)
            cameraActive = true
            cameraBtn.textContent = 'Stop Camera'
            log('Camera started')
        } catch (err) {
            log(`Camera error: ${err instanceof Error ? err.message : String(err)}`, 'warn')
        }
    }
})

// ── Leave ─────────────────────────────────────────────────────────────────────

leaveBtn.addEventListener('click', cleanup)

function cleanup() {
    if (localStream) {
        for (const t of localStream.getTracks()) t.stop()
    }
    call?.close()
    client?.leave().catch(() => {})
    localStream = null
    call = null
    client = null
    currentRoom = null
    cameraActive = false
    peerTiles.clear()
    videoGrid.innerHTML = ''
    peersList.innerHTML = '<li class="empty">No other peers yet</li>'
    cameraBtn.textContent = 'Toggle Camera'
    roomView.style.display = 'none'
    joinForm.style.display = 'flex'
    joinBtn.disabled = false
    eventLog.innerHTML = ''
}
