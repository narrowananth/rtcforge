import { Call, MediaEvent, getUserMedia } from '@rtcforge/media'
import { MessageType, RTCForgeClient } from '@rtcforge/sdk'
import type { Room } from '@rtcforge/sdk'

const SERVER_URL = 'ws://localhost:3004'

// ── DOM refs ──────────────────────────────────────────────────────────────────

const joinForm = document.getElementById('join-form') as HTMLDivElement
const roomView = document.getElementById('room-view') as HTMLDivElement
const peerIdInput = document.getElementById('peer-id') as HTMLInputElement
const roomIdInput = document.getElementById('room-id') as HTMLInputElement
const roleSelect = document.getElementById('role') as HTMLSelectElement
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement
const roomTitle = document.getElementById('room-title') as HTMLHeadingElement
const roleBadge = document.getElementById('role-badge') as HTMLSpanElement
const viewerCountBadge = document.getElementById('viewer-count-badge') as HTMLSpanElement
const videoContainer = document.getElementById('video-container') as HTMLDivElement
const viewerList = document.getElementById('viewer-list') as HTMLUListElement
const hostPanel = document.getElementById('host-panel') as HTMLDivElement
const eventLog = document.getElementById('event-log') as HTMLDivElement
const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement

// ── State ─────────────────────────────────────────────────────────────────────

let client: RTCForgeClient | null = null
let call: Call | null = null
let localStream: MediaStream | null = null
const viewers = new Set<string>()
const remoteTiles = new Map<string, HTMLDivElement>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string, level: 'info' | 'warn' | 'err' = 'info') {
    const entry = document.createElement('div')
    entry.className = `log-entry ${level}`
    const time = new Date().toLocaleTimeString()
    entry.innerHTML = `<span class="time">${time}</span>${msg}`
    eventLog.appendChild(entry)
    eventLog.scrollTop = eventLog.scrollHeight
}

function makeToken(roomId: string, peerId: string, role: string): string {
    return btoa(JSON.stringify({ roomId, peerId, role }))
}

function addVideoTile(id: string, stream: MediaStream, label: string, cls: string): HTMLDivElement {
    const tile = document.createElement('div')
    tile.className = `video-tile ${cls}`
    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.muted = id === 'local'
    video.srcObject = stream
    const lbl = document.createElement('div')
    lbl.className = 'video-label'
    lbl.textContent = label
    tile.appendChild(video)
    tile.appendChild(lbl)
    videoContainer.appendChild(tile)
    return tile
}

function removeVideoTile(id: string) {
    const tile = remoteTiles.get(id)
    if (tile) {
        tile.remove()
        remoteTiles.delete(id)
    }
}

function updateViewerCount() {
    viewerCountBadge.textContent = `${viewers.size} viewer${viewers.size !== 1 ? 's' : ''}`
}

function renderViewerList() {
    viewerList.innerHTML = ''
    if (viewers.size === 0) {
        viewerList.innerHTML = '<li class="empty">No viewers yet</li>'
        return
    }
    for (const id of viewers) {
        const li = document.createElement('li')
        li.textContent = id
        viewerList.appendChild(li)
    }
}

// ── Join ──────────────────────────────────────────────────────────────────────

joinBtn.addEventListener('click', async () => {
    const peerId = peerIdInput.value.trim()
    const roomId = roomIdInput.value.trim()
    const role = roleSelect.value

    if (!peerId || !roomId) {
        alert('Enter peer ID and room ID')
        return
    }

    joinBtn.disabled = true

    const token = makeToken(roomId, peerId, role)
    client = new RTCForgeClient({ serverUrl: SERVER_URL, token })

    const room: Room | null = await client.joinRoom(roomId).catch((err: unknown) => {
        log(`Connection failed: ${err instanceof Error ? err.message : String(err)}`, 'err')
        joinBtn.disabled = false
        return null
    })
    if (!room) return

    joinForm.style.display = 'none'
    roomView.style.display = 'block'
    roomTitle.textContent = `Room: ${room.id}`
    roleBadge.textContent = role === 'host' ? 'HOST' : 'VIEWER'
    roleBadge.className = `role-badge ${role}`

    if (role === 'host') {
        hostPanel.style.display = 'block'

        // Get camera and mic
        try {
            localStream = await getUserMedia({ video: true, audio: true })
            const tile = addVideoTile('local', localStream, `${peerId} (you)`, 'host-tile')
            remoteTiles.set('local', tile)
            log('Camera started')
        } catch {
            log('Camera unavailable — host will stream audio only', 'warn')
        }

        // Set up mesh call for signaling
        call = new Call(room)
        if (localStream) {
            for (const track of localStream.getTracks()) {
                call.addTrack(track, localStream)
            }
        }
        room.bindCall(call)

        log(`Joined as host in room "${room.id}"`)
    } else {
        // Viewer — receive host stream
        call = new Call(room)
        room.bindCall(call)

        call.on(MediaEvent.RemoteStream, (fromPeerId, stream) => {
            log(`Receiving stream from ${fromPeerId}`)
            if (!remoteTiles.has(fromPeerId)) {
                const tile = addVideoTile(fromPeerId, stream, `Host: ${fromPeerId}`, 'viewer-tile')
                remoteTiles.set(fromPeerId, tile)
            }
        })

        log(`Joined as viewer in room "${room.id}"`)
    }

    // Track peer events (for host: know when viewers join/leave)
    room.on(MessageType.PeerJoined, (peerId) => {
        log(`Peer joined: ${peerId}`)
        if (role === 'host') {
            viewers.add(peerId)
            updateViewerCount()
            renderViewerList()
        }
    })

    room.on(MessageType.PeerLeft, (peerId) => {
        log(`Peer left: ${peerId}`)
        if (role === 'host') {
            viewers.delete(peerId)
            updateViewerCount()
            renderViewerList()
        }
        removeVideoTile(peerId)
    })

    room.on(MessageType.Kicked, (_peerId, reason) => {
        log(`You were kicked${reason ? `: ${reason}` : ''}`, 'warn')
        cleanup()
    })

    log('Connected to signaling server')
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
    viewers.clear()
    remoteTiles.clear()
    videoContainer.innerHTML = ''
    joinForm.style.display = 'block'
    roomView.style.display = 'none'
    joinBtn.disabled = false
    eventLog.innerHTML = ''
    log('Left the room')
}
