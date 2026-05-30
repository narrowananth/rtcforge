import { ClientEvent, MessageType, RTCForgeClient, RoomEvent } from '@rtcforge/sdk'
import type { Room } from '@rtcforge/sdk'

const SIGNALING_URL = 'ws://localhost:3005'

// ── DOM refs ──────────────────────────────────────────────────────────────────

const joinFormEl = document.getElementById('join-form') as HTMLDivElement
const roomViewEl = document.getElementById('room-view') as HTMLDivElement
const peerIdInput = document.getElementById('peer-id') as HTMLInputElement
const roomIdInput = document.getElementById('room-id') as HTMLInputElement
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement
const roomTitleEl = document.getElementById('room-title') as HTMLElement
const myPeerTagEl = document.getElementById('my-peer-tag') as HTMLElement
const membersListEl = document.getElementById('members-list') as HTMLUListElement
const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement
const colorPickerEl = document.getElementById('color-picker') as HTMLInputElement
const brushSizeEl = document.getElementById('brush-size') as HTMLInputElement
const brushSizeLabelEl = document.getElementById('brush-size-label') as HTMLElement
const toolPenBtn = document.getElementById('tool-pen') as HTMLButtonElement
const toolEraserBtn = document.getElementById('tool-eraser') as HTMLButtonElement
const canvas = document.getElementById('whiteboard-canvas') as HTMLCanvasElement
const cursorOverlay = document.getElementById('cursor-overlay') as HTMLDivElement

// ── State ─────────────────────────────────────────────────────────────────────

type Tool = 'pen' | 'eraser'

let client: RTCForgeClient | null = null
let currentRoom: Room | null = null
let tool: Tool = 'pen'
let isDrawing = false
let lastX = 0
let lastY = 0

const ERASER_COLOR = '#1a1a1a'
const remoteCursors = new Map<string, HTMLDivElement>()

const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

// ── Canvas helpers ────────────────────────────────────────────────────────────

function resizeCanvas(): void {
    const rect = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    // Save current drawing
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    ctx.scale(dpr, dpr)
    ctx.putImageData(imageData, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
}

function getCanvasPos(e: MouseEvent | Touch): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
    }
}

function drawSegment(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width: number,
): void {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
}

function clearCanvas(): void {
    ctx.clearRect(
        0,
        0,
        canvas.width / (window.devicePixelRatio || 1),
        canvas.height / (window.devicePixelRatio || 1),
    )
}

// ── Tool selection ────────────────────────────────────────────────────────────

function setTool(t: Tool): void {
    tool = t
    toolPenBtn.classList.toggle('active', t === 'pen')
    toolEraserBtn.classList.toggle('active', t === 'eraser')
    canvas.style.cursor = t === 'eraser' ? 'crosshair' : 'default'
}

toolPenBtn.addEventListener('click', () => setTool('pen'))
toolEraserBtn.addEventListener('click', () => setTool('eraser'))

brushSizeEl.addEventListener('input', () => {
    brushSizeLabelEl.textContent = `${brushSizeEl.value}px`
})

// ── Drawing events ────────────────────────────────────────────────────────────

canvas.addEventListener('mousedown', (e) => {
    if (!currentRoom) return
    isDrawing = true
    const pos = getCanvasPos(e)
    lastX = pos.x
    lastY = pos.y
})

canvas.addEventListener('mousemove', (e) => {
    const room = currentRoom
    if (!room) return

    const pos = getCanvasPos(e)

    // Send cursor position
    room.broadcast('whiteboard', {
        type: 'cursor',
        x: pos.x,
        y: pos.y,
    })

    if (!isDrawing) return

    const color = tool === 'eraser' ? ERASER_COLOR : colorPickerEl.value
    const width = Number(brushSizeEl.value)
    const eventType = tool === 'eraser' ? 'erase' : 'draw'

    drawSegment(lastX, lastY, pos.x, pos.y, color, width)
    room.broadcast('whiteboard', {
        type: eventType,
        x1: lastX,
        y1: lastY,
        x2: pos.x,
        y2: pos.y,
        color,
        width,
    })

    lastX = pos.x
    lastY = pos.y
})

canvas.addEventListener('mouseup', () => {
    isDrawing = false
})

canvas.addEventListener('mouseleave', () => {
    isDrawing = false
})

// Touch support
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault()
    if (!currentRoom || !e.touches[0]) return
    isDrawing = true
    const pos = getCanvasPos(e.touches[0])
    lastX = pos.x
    lastY = pos.y
})

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault()
    const room = currentRoom
    if (!room || !e.touches[0]) return

    const pos = getCanvasPos(e.touches[0])

    if (!isDrawing) return

    const color = tool === 'eraser' ? ERASER_COLOR : colorPickerEl.value
    const width = Number(brushSizeEl.value)
    const eventType = tool === 'eraser' ? 'erase' : 'draw'

    drawSegment(lastX, lastY, pos.x, pos.y, color, width)
    room.broadcast('whiteboard', {
        type: eventType,
        x1: lastX,
        y1: lastY,
        x2: pos.x,
        y2: pos.y,
        color,
        width,
    })

    lastX = pos.x
    lastY = pos.y
})

canvas.addEventListener('touchend', () => {
    isDrawing = false
})

// ── Clear button ──────────────────────────────────────────────────────────────

clearBtn.addEventListener('click', () => {
    const room = currentRoom
    if (!room) return
    clearCanvas()
    room.broadcast('whiteboard', {
        type: 'clear',
    })
})

// ── Handle incoming broadcast events ─────────────────────────────────────────

function handleWhiteboardEvent(from: string, data: unknown): void {
    const payload = data as { type?: string; [k: string]: unknown }

    if (payload.type === 'draw' || payload.type === 'erase') {
        drawSegment(
            payload.x1 as number,
            payload.y1 as number,
            payload.x2 as number,
            payload.y2 as number,
            payload.color as string,
            payload.width as number,
        )
    } else if (payload.type === 'clear') {
        clearCanvas()
        removeAllRemoteCursors()
    } else if (payload.type === 'cursor') {
        updateRemoteCursor(from, payload.x as number, payload.y as number)
    } else if (payload.type === 'sync') {
        // Full state sync from server on join
        clearCanvas()
        const syncPayload = payload as { strokes?: Array<{ type: string; data: unknown }> }
        for (const stroke of syncPayload.strokes ?? []) {
            handleWhiteboardEvent('server', stroke.data)
        }
    }
}

// ── Remote cursor management ──────────────────────────────────────────────────

function updateRemoteCursor(peerId: string, x: number, y: number): void {
    let cursorEl = remoteCursors.get(peerId)
    if (!cursorEl) {
        cursorEl = document.createElement('div')
        cursorEl.className = 'remote-cursor'
        cursorEl.dataset.peerId = peerId
        const label = document.createElement('span')
        label.className = 'cursor-label'
        label.textContent = peerId
        cursorEl.appendChild(label)
        cursorOverlay.appendChild(cursorEl)
        remoteCursors.set(peerId, cursorEl)
    }
    const canvasRect = canvas.getBoundingClientRect()
    const overlayRect = cursorOverlay.getBoundingClientRect()
    cursorEl.style.left = `${canvasRect.left - overlayRect.left + x}px`
    cursorEl.style.top = `${canvasRect.top - overlayRect.top + y}px`
}

function removeRemoteCursor(peerId: string): void {
    remoteCursors.get(peerId)?.remove()
    remoteCursors.delete(peerId)
}

function removeAllRemoteCursors(): void {
    for (const el of remoteCursors.values()) el.remove()
    remoteCursors.clear()
}

// ── Members list ──────────────────────────────────────────────────────────────

function renderMembers(): void {
    const room = currentRoom
    membersListEl.innerHTML = ''
    for (const id of room?.peers ?? []) {
        const li = document.createElement('li')
        const span = document.createElement('span')
        span.textContent = id
        if (room && id === room.localPeerId) {
            const tag = document.createElement('span')
            tag.className = 'you-tag'
            tag.textContent = '(you)'
            li.appendChild(span)
            li.appendChild(tag)
        } else {
            li.appendChild(span)
        }
        membersListEl.appendChild(li)
    }
}

// ── Join ──────────────────────────────────────────────────────────────────────

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
        roomViewEl.style.display = 'flex'
        roomTitleEl.textContent = `#${room.id}`
        myPeerTagEl.textContent = room.localPeerId

        resizeCanvas()
        setTool('pen')
        renderMembers()

        // Listen for whiteboard broadcast events
        room.on(MessageType.Broadcast, (from: string, channel: string, data: unknown) => {
            if (channel !== 'whiteboard') return
            handleWhiteboardEvent(from, data)
        })

        room.on(MessageType.PeerJoined, () => renderMembers())
        room.on(MessageType.PeerLeft, (id) => {
            removeRemoteCursor(id)
            renderMembers()
        })

        room.on(RoomEvent.Closed, () => {
            appendStatus('Room closed')
        })

        client.on(ClientEvent.Disconnected, (code, reason) => {
            appendStatus(`Disconnected (${code}: ${reason})`)
        })
    } catch (err) {
        appendStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
        joinBtn.disabled = false
        joinBtn.textContent = 'Join Room'
    }
})

// ── Leave ─────────────────────────────────────────────────────────────────────

leaveBtn.addEventListener('click', async () => {
    isDrawing = false
    removeAllRemoteCursors()

    currentRoom?.removeAllListeners()
    client?.removeAllListeners()
    await client?.leave()
    client = null
    currentRoom = null

    clearCanvas()

    joinFormEl.style.display = 'flex'
    roomViewEl.style.display = 'none'
    setTool('pen')
    renderMembers()
})

// ── Status helper ─────────────────────────────────────────────────────────────

function appendStatus(text: string): void {
    const el = document.getElementById('status-bar')
    if (!el) return
    el.textContent = text
    el.style.display = 'block'
    setTimeout(() => {
        el.style.display = 'none'
    }, 4000)
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
    if (currentRoom) resizeCanvas()
})

setTool('pen')
brushSizeLabelEl.textContent = `${brushSizeEl.value}px`
