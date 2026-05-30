import { Call, MediaEvent, getUserMedia } from '@rtcforge/media'
import { ClientEvent, MessageType, RTCForgeClient, RoomEvent } from '@rtcforge/sdk'
import type { Room } from '@rtcforge/sdk'

const SIGNALING_URL = 'ws://localhost:3003'
const MAX_LOG_ENTRIES = 100

const AppSignalType = {
    Ping: 'ping',
    Pong: 'pong',
} as const

const joinFormEl = document.getElementById('join-form') as HTMLElement
const roomViewEl = document.getElementById('room-view') as HTMLElement
const peerIdInput = document.getElementById('peer-id') as HTMLInputElement
const roomIdInput = document.getElementById('room-id') as HTMLInputElement
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement
const roomTitle = document.getElementById('room-title') as HTMLElement
const myPeerTag = document.getElementById('my-peer-tag') as HTMLElement
const peersList = document.getElementById('peers-list') as HTMLElement
const signalLogEl = document.getElementById('signal-log') as HTMLElement
const videoGridEl = document.getElementById('video-grid') as HTMLElement
const noVideoHint = document.getElementById('no-video-hint') as HTMLElement
const pingAllBtn = document.getElementById('ping-all-btn') as HTMLButtonElement
const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement
const cameraBtn = document.getElementById('camera-btn') as HTMLButtonElement
const micBtn = document.getElementById('mic-btn') as HTMLButtonElement
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement
const recordingStatusEl = document.getElementById('recording-status') as HTMLElement
const recTimerEl = document.getElementById('rec-timer') as HTMLElement

let client: RTCForgeClient | null = null
let currentRoom: Room | null = null
let localStream: MediaStream | null = null
let call: Call | null = null

let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let recMimeType = ''
let recTimerInterval: ReturnType<typeof setInterval> | null = null
let recStartTime = 0

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

    // Stop any stream left over from a previous failed join attempt
    if (localStream && !currentRoom) {
        for (const track of localStream.getTracks()) track.stop()
        localStream = null
        clearVideoGrid()
        cameraBtn.disabled = true
        micBtn.disabled = true
    }

    try {
        // Try to get camera + mic; proceed without if denied
        try {
            localStream = await getUserMedia({ video: true, audio: true })
            addVideoTile('local', peerId, localStream, true)
            noVideoHint.style.display = 'none'
            cameraBtn.disabled = false
            micBtn.disabled = false
            recordBtn.disabled = false
            updateMediaButtons()
        } catch {
            log('sys', 'Camera/mic unavailable — joining without media')
        }

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

        // Start WebRTC call if we have media
        if (localStream) {
            call = new Call(room, { stream: localStream })

            call.on(MediaEvent.RemoteStream, (remotePeerId, stream) => {
                addVideoTile(remotePeerId, remotePeerId, stream, false)
                log('sys', `Video stream from ${remotePeerId}`)
            })

            call.on(MediaEvent.RemoteStreamRemoved, (remotePeerId) => {
                removeVideoTile(remotePeerId)
                log('sys', `Video stream ended: ${remotePeerId}`)
            })

            call.start()
        }

        room.on(MessageType.PeerJoined, (id) => {
            log('sys', `${id} joined`)
            renderPeers()
        })

        room.on(MessageType.PeerLeft, (id) => {
            log('sys', `${id} left`)
            renderPeers()
        })

        room.on(MessageType.Signal, (from, data) => {
            // Only log non-media signals to avoid cluttering the log with WebRTC internals
            const d = data as Record<string, unknown>
            if (d?.kind !== 'media') {
                log('in', `signal from ${from}: ${JSON.stringify(data)}`)
            }
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

cameraBtn.addEventListener('click', () => {
    if (!localStream) return
    const tracks = localStream.getVideoTracks()
    const nowEnabled = !(tracks[0]?.enabled ?? false)
    for (const t of tracks) t.enabled = nowEnabled
    updateMediaButtons()
})

micBtn.addEventListener('click', () => {
    if (!localStream) return
    const tracks = localStream.getAudioTracks()
    const nowEnabled = !(tracks[0]?.enabled ?? false)
    for (const t of tracks) t.enabled = nowEnabled
    updateMediaButtons()
})

recordBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop()
    } else {
        startRecording()
    }
})

leaveBtn.addEventListener('click', async () => {
    if (mediaRecorder?.state !== 'inactive') mediaRecorder?.stop()
    mediaRecorder = null
    recordedChunks = []
    call?.close()
    call = null

    if (localStream) {
        for (const track of localStream.getTracks()) track.stop()
        localStream = null
    }

    clearVideoGrid()

    currentRoom?.removeAllListeners()
    client?.removeAllListeners()
    await client?.leave()
    client = null
    currentRoom = null

    cameraBtn.disabled = true
    micBtn.disabled = true
    recordBtn.disabled = true

    joinFormEl.style.display = 'block'
    roomViewEl.style.display = 'none'
    renderPeers()
    signalLogEl.innerHTML = ''
})

function sendPingTo(peerId: string, ts = Date.now()): void {
    const room = currentRoom
    if (!room) return
    const payload = { type: AppSignalType.Ping, from: room.localPeerId, ts }
    room.sendSignal(peerId, payload)
    log('out', `signal to ${peerId}: ${JSON.stringify(payload)}`)
}

function addVideoTile(id: string, label: string, stream: MediaStream, muted: boolean): void {
    removeVideoTile(id)

    const tile = document.createElement('div')
    tile.id = `video-${id}`
    tile.className = `video-tile${id === 'local' ? ' local' : ''}`

    const video = document.createElement('video')
    video.autoplay = true
    video.muted = muted
    video.playsInline = true
    video.srcObject = stream

    const labelEl = document.createElement('span')
    labelEl.className = 'video-label'
    labelEl.textContent = id === 'local' ? `You (${label})` : label

    tile.appendChild(video)
    tile.appendChild(labelEl)
    videoGridEl.appendChild(tile)
}

function removeVideoTile(id: string): void {
    document.getElementById(`video-${id}`)?.remove()
}

function clearVideoGrid(): void {
    videoGridEl.innerHTML = ''
    const hint = document.createElement('p')
    hint.id = 'no-video-hint'
    hint.textContent = 'Camera not available'
    videoGridEl.appendChild(hint)
    noVideoHint.style.display = ''
}

function updateMediaButtons(): void {
    if (!localStream) return
    const camOn = localStream.getVideoTracks()[0]?.enabled ?? false
    const micOn = localStream.getAudioTracks()[0]?.enabled ?? false
    cameraBtn.textContent = camOn ? 'Camera: On' : 'Camera: Off'
    cameraBtn.className = camOn ? 'active' : 'secondary'
    micBtn.textContent = micOn ? 'Mic: On' : 'Mic: Off'
    micBtn.className = micOn ? 'active' : 'secondary'
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

function startRecording(): void {
    if (!localStream) return

    const candidateTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
    ]
    recMimeType = candidateTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
    recordedChunks = []

    const opts: MediaRecorderOptions = recMimeType ? { mimeType: recMimeType } : {}
    mediaRecorder = new MediaRecorder(localStream, opts)

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data)
    }

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: recMimeType || 'video/webm' })
        const ext = recMimeType.includes('mp4') ? 'mp4' : 'webm'
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `recording-${Date.now()}.${ext}`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        log('sys', `Recording saved (${(blob.size / 1024).toFixed(0)} KB)`)
        resetRecordingUI()
    }

    mediaRecorder.onerror = (e) => {
        log('sys', `Recording error: ${(e as ErrorEvent).message ?? 'unknown error'}`)
        resetRecordingUI()
    }

    mediaRecorder.start(1000)

    recStartTime = Date.now()
    recTimerInterval = setInterval(() => {
        recTimerEl.textContent = formatDuration(Date.now() - recStartTime)
    }, 1000)

    recordBtn.textContent = 'Stop Rec'
    recordBtn.className = 'recording'
    recordingStatusEl.classList.add('active')
    recTimerEl.textContent = '0:00'
    log('sys', 'Recording started')
}

function resetRecordingUI(): void {
    clearInterval(recTimerInterval ?? undefined)
    recTimerInterval = null
    mediaRecorder = null
    recordedChunks = []
    recordBtn.textContent = 'Record'
    recordBtn.className = 'secondary'
    recordingStatusEl.classList.remove('active')
}

function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return `${m}:${String(s % 60).padStart(2, '0')}`
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
