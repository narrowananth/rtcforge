import { ClientEvent, MessageType, RTCForgeClient, RoomEvent } from '@rtcforge/sdk'
import type { Room } from '@rtcforge/sdk'

const SIGNALING_URL = 'ws://localhost:3001'
const TYPING_DEBOUNCE_MS = 2000
const TYPING_CLEAR_MS = 3500
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

// ── Local types ───────────────────────────────────────────────────────────────

interface ChatMessage {
    id: string
    from: string
    text?: string
    ts: number
    to?: string | string[]
    editedAt?: number
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const joinFormEl = document.getElementById('join-form') as HTMLDivElement
const roomViewEl = document.getElementById('room-view') as HTMLDivElement
const peerIdInput = document.getElementById('peer-id') as HTMLInputElement
const roomIdInput = document.getElementById('room-id') as HTMLInputElement
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement
const roomTitleEl = document.getElementById('room-title') as HTMLElement
const myPeerTagEl = document.getElementById('my-peer-tag') as HTMLElement
const membersListEl = document.getElementById('members-list') as HTMLUListElement
const messagesEl = document.getElementById('messages') as HTMLDivElement
const typingIndicatorEl = document.getElementById('typing-indicator') as HTMLDivElement
const messageInputEl = document.getElementById('message-input') as HTMLInputElement
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement
const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement
const modeBroadcastBtn = document.getElementById('mode-broadcast') as HTMLButtonElement
const modeDmBtn = document.getElementById('mode-dm') as HTMLButtonElement
const modeGroupBtn = document.getElementById('mode-group') as HTMLButtonElement
const recipientBannerEl = document.getElementById('recipient-banner') as HTMLDivElement

// ── State ─────────────────────────────────────────────────────────────────────

type ChatMode = 'broadcast' | 'dm' | 'group'

let client: RTCForgeClient | null = null
let currentRoom: Room | null = null
let typingCooldown = false
let chatMode: ChatMode = 'broadcast'
const selectedPeers = new Set<string>()
const typingPeers = new Set<string>()
const typingClearTimers = new Map<string, ReturnType<typeof setTimeout>>()
const msgEls = new Map<string, HTMLDivElement>()
const reactionState = new Map<string, Map<string, Set<string>>>()
// Per-message routing target: undefined = public broadcast; string[] = the thread
// participants (DM/group). Follow-up ops (edit/delete/reaction/read) route the same
// way as the original message so private threads stay private on the wire.
const msgRecipients = new Map<string, string[] | undefined>()

// ── Mode switching ─────────────────────────────────────────────────────────────

function setMode(mode: ChatMode): void {
    chatMode = mode
    selectedPeers.clear()
    modeBroadcastBtn.classList.toggle('active', mode === 'broadcast')
    modeDmBtn.classList.toggle('active', mode === 'dm')
    modeGroupBtn.classList.toggle('active', mode === 'group')
    renderMembers()
    renderRecipientBanner()
    messageInputEl.placeholder =
        mode === 'broadcast'
            ? 'Message everyone…'
            : mode === 'dm'
              ? 'Select a member, then type…'
              : 'Select members, then type…'
}

function renderRecipientBanner(): void {
    if (chatMode === 'broadcast') {
        recipientBannerEl.textContent = ''
        recipientBannerEl.style.display = 'none'
        return
    }
    recipientBannerEl.style.display = 'block'
    if (selectedPeers.size === 0) {
        recipientBannerEl.textContent =
            chatMode === 'dm' ? 'Click a member to send a DM' : 'Click members to add to group'
        return
    }
    const names = [...selectedPeers].join(', ')
    recipientBannerEl.textContent = chatMode === 'dm' ? `DM → ${names}` : `Group → ${names}`
}

modeBroadcastBtn.addEventListener('click', () => setMode('broadcast'))
modeDmBtn.addEventListener('click', () => setMode('dm'))
modeGroupBtn.addEventListener('click', () => setMode('group'))

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

        setMode('broadcast')
        renderMembers()

        // ── Chat delivery ─────────────────────────────────────────────────────
        // Public messages arrive on the broadcast channel; DM/group messages arrive
        // as point-to-point signals (server only relays them to the named recipients,
        // so they never touch other peers' sockets). Both feed the same processor.
        room.on(MessageType.Broadcast, (from: string, channel: string, data: unknown) => {
            if (channel !== 'chat') return
            handleChatPayload(from, data)
        })
        room.on(MessageType.Signal, (from: string, data: unknown) => {
            const payload = data as Record<string, unknown> | null
            if (payload && typeof payload.type === 'string') handleChatPayload(from, data)
        })

        room.on(MessageType.PeerJoined, () => renderMembers())
        room.on(MessageType.PeerLeft, (id) => {
            clearTypingForPeer(id)
            selectedPeers.delete(id)
            renderMembers()
            renderRecipientBanner()
        })

        room.on(RoomEvent.Closed, () => appendSystemMessage('Room closed'))

        client.on(ClientEvent.Disconnected, (code, reason) => {
            appendSystemMessage(`Disconnected (${code}: ${reason})`)
        })

        messageInputEl.focus()
    } catch (err) {
        appendSystemMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
        joinBtn.disabled = false
        joinBtn.textContent = 'Join Room'
    }
})

// ── Send ──────────────────────────────────────────────────────────────────────

sendBtn.addEventListener('click', sendMessage)

messageInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
    }
})

messageInputEl.addEventListener('input', () => {
    if (!currentRoom || typingCooldown) return
    currentRoom.broadcast('chat', { type: 'typing' })
    typingCooldown = true
    setTimeout(() => {
        typingCooldown = false
    }, TYPING_DEBOUNCE_MS)
})

// Thread participants for a message, excluding the local peer: the set that must
// receive every op on this message. `undefined` means a public broadcast.
function participantsOf(from: string, to: string | string[] | undefined): string[] | undefined {
    if (to === undefined) return undefined
    const set = new Set<string>([from, ...(Array.isArray(to) ? to : [to])])
    const local = currentRoom?.localPeerId
    if (local) set.delete(local)
    return [...set]
}

// Send a chat payload to its audience, then apply it locally (the wire never echoes
// to the sender, so own messages/edits/reactions are rendered optimistically).
function routeChat(payload: Record<string, unknown>, recipients: string[] | undefined): void {
    const room = currentRoom
    if (!room) return
    if (recipients === undefined) {
        room.broadcast('chat', payload)
    } else {
        for (const r of recipients) room.sendSignal(r, payload)
    }
    handleChatPayload(room.localPeerId, payload)
}

// Single processor for every inbound/local chat payload, regardless of transport.
function handleChatPayload(from: string, data: unknown): void {
    const room = currentRoom
    if (!room) return
    const payload = data as Record<string, unknown>

    switch (payload.type) {
        case 'message': {
            const msg = payload as unknown as ChatMessage & { type: string }
            const recipients = participantsOf(from, msg.to)
            msgRecipients.set(msg.id, recipients)
            const chatMsg: ChatMessage = {
                id: msg.id,
                from,
                text: msg.text,
                ts: msg.ts,
                to: msg.to,
            }
            clearTypingForPeer(from)
            appendMessage(chatMsg, room.localPeerId)
            if (from !== room.localPeerId) {
                routeChat({ type: 'read', id: msg.id }, recipients)
            }
            break
        }
        case 'typing': {
            if (from === room.localPeerId) return
            typingPeers.add(from)
            clearTimeout(typingClearTimers.get(from))
            const t = setTimeout(() => {
                typingPeers.delete(from)
                typingClearTimers.delete(from)
                renderTypingIndicator()
            }, TYPING_CLEAR_MS)
            typingClearTimers.set(from, t)
            renderTypingIndicator()
            break
        }
        case 'edit': {
            const { id, text } = payload as { id: string; text: string }
            const el = msgEls.get(id)
            if (!el) return
            el.dataset.text = text
            const bodyEl = el.querySelector('.message-body') as HTMLElement
            const textNode = bodyEl?.childNodes[0]
            if (textNode?.nodeType === Node.TEXT_NODE) textNode.textContent = text
            if (!bodyEl.querySelector('.edited-label')) {
                const label = document.createElement('span')
                label.className = 'edited-label'
                label.textContent = '(edited)'
                bodyEl.appendChild(label)
            }
            break
        }
        case 'delete': {
            const { id } = payload as { id: string }
            const el = msgEls.get(id)
            if (!el) return
            const bodyEl = el.querySelector('.message-body') as HTMLElement
            bodyEl.innerHTML = '<em style="color:#555">This message was deleted.</em>'
            el.querySelector('.message-actions')?.remove()
            msgEls.delete(id)
            break
        }
        case 'reaction': {
            const { msgId, emoji, action } = payload as {
                msgId: string
                emoji: string
                action: 'add' | 'remove'
            }
            let msgReactions = reactionState.get(msgId)
            if (!msgReactions) {
                msgReactions = new Map()
                reactionState.set(msgId, msgReactions)
            }
            const peers = msgReactions.get(emoji) ?? new Set<string>()
            msgReactions.set(emoji, peers)
            if (action === 'remove') {
                peers.delete(from)
            } else {
                peers.add(from)
            }
            renderReactions(msgId, room.localPeerId)
            break
        }
        case 'read':
            // Acknowledged — no UI change needed in this example
            break
        default:
            break
    }
}

function sendMessage(): void {
    const room = currentRoom
    const text = messageInputEl.value.trim()
    if (!room || !text) return

    let to: string | string[] | undefined
    if (chatMode === 'dm') {
        if (selectedPeers.size === 0) {
            appendSystemMessage('Select a member to DM first.')
            return
        }
        to = [...selectedPeers][0]
    } else if (chatMode === 'group') {
        if (selectedPeers.size === 0) {
            appendSystemMessage('Select at least one member for a group message.')
            return
        }
        to = [...selectedPeers]
    }

    const id = crypto.randomUUID()
    const ts = Date.now()
    const recipients = to === undefined ? undefined : Array.isArray(to) ? to : [to]
    routeChat({ type: 'message', id, text, ts, ...(to !== undefined ? { to } : {}) }, recipients)
    messageInputEl.value = ''
}

// ── Leave ─────────────────────────────────────────────────────────────────────

leaveBtn.addEventListener('click', async () => {
    for (const t of typingClearTimers.values()) clearTimeout(t)
    typingClearTimers.clear()
    typingPeers.clear()
    selectedPeers.clear()
    msgEls.clear()
    reactionState.clear()

    currentRoom?.removeAllListeners()
    client?.removeAllListeners()
    await client?.leave()
    client = null
    currentRoom = null

    joinFormEl.style.display = 'flex'
    roomViewEl.style.display = 'none'
    messagesEl.innerHTML = ''
    typingIndicatorEl.textContent = ''
    setMode('broadcast')
})

// ── Render ────────────────────────────────────────────────────────────────────

function renderMembers(): void {
    const room = currentRoom
    membersListEl.innerHTML = ''
    for (const id of room?.peers ?? []) {
        const li = document.createElement('li')
        li.dataset.peerId = id

        const dot = document.createElement('span')
        dot.className = 'online-dot'
        li.appendChild(dot)

        const name = document.createElement('span')
        name.className = 'member-name'
        name.textContent = id
        li.appendChild(name)

        if (room && id === room.localPeerId) {
            const tag = document.createElement('span')
            tag.className = 'you-tag'
            tag.textContent = '(you)'
            li.appendChild(tag)
        } else if (chatMode !== 'broadcast') {
            if (selectedPeers.has(id)) li.classList.add('selected')
            li.addEventListener('click', () => togglePeerSelection(id))
        }

        membersListEl.appendChild(li)
    }
}

function togglePeerSelection(peerId: string): void {
    if (chatMode === 'dm') {
        selectedPeers.clear()
        selectedPeers.add(peerId)
    } else if (chatMode === 'group') {
        if (selectedPeers.has(peerId)) selectedPeers.delete(peerId)
        else selectedPeers.add(peerId)
    }
    renderMembers()
    renderRecipientBanner()
}

function renderTypingIndicator(): void {
    if (typingPeers.size === 0) {
        typingIndicatorEl.textContent = ''
        return
    }
    const names = [...typingPeers]
    typingIndicatorEl.textContent =
        names.length === 1 ? `${names[0]} is typing…` : `${names.join(', ')} are typing…`
}

function renderReactions(msgId: string, localPeerId: string): void {
    const el = msgEls.get(msgId)
    if (!el) return
    let reactionsEl = el.querySelector('.reactions') as HTMLDivElement | null
    if (!reactionsEl) {
        reactionsEl = document.createElement('div')
        reactionsEl.className = 'reactions'
        const actionsEl = el.querySelector('.message-actions')
        actionsEl ? el.insertBefore(reactionsEl, actionsEl) : el.appendChild(reactionsEl)
    }
    reactionsEl.innerHTML = ''
    const msgReactions = reactionState.get(msgId)
    if (!msgReactions) return
    for (const [emoji, peers] of msgReactions) {
        if (!peers.size) continue
        const chip = document.createElement('span')
        chip.className = `reaction-chip${peers.has(localPeerId) ? ' mine' : ''}`
        chip.textContent = `${emoji} ${peers.size}`
        chip.addEventListener('click', () => {
            const hasReacted = reactionState.get(msgId)?.get(emoji)?.has(localPeerId) ?? false
            routeChat(
                { type: 'reaction', msgId, emoji, action: hasReacted ? 'remove' : 'add' },
                msgRecipients.get(msgId),
            )
        })
        reactionsEl.appendChild(chip)
    }
}

function buildRecipientLabel(msg: ChatMessage, localPeerId: string): string | null {
    if (!msg.to) return null
    if (typeof msg.to === 'string') {
        return msg.from === localPeerId ? `DM → ${msg.to}` : 'DM'
    }
    const others = msg.to.filter((id) => id !== localPeerId)
    if (msg.from === localPeerId) {
        return `Group → ${msg.to.join(', ')}`
    }
    return others.length > 0 ? `Group (${msg.to.length})` : 'Group'
}

function appendMessage(msg: ChatMessage, localPeerId: string): void {
    const isSelf = msg.from === localPeerId
    const msgTypeClass = !msg.to ? '' : typeof msg.to === 'string' ? ' dm-msg' : ' group-msg'
    const div = document.createElement('div')
    div.className = `message ${isSelf ? 'self' : 'other'}${msgTypeClass}`
    div.dataset.text = msg.text ?? ''

    const meta = document.createElement('div')
    meta.className = 'message-meta'
    const sender = document.createElement('span')
    sender.className = 'sender'
    sender.textContent = isSelf ? 'You' : msg.from
    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = new Date(msg.ts).toLocaleTimeString()
    meta.appendChild(sender)

    const recipientLabel = buildRecipientLabel(msg, localPeerId)
    if (recipientLabel) {
        const badge = document.createElement('span')
        badge.className = `msg-badge ${typeof msg.to === 'string' ? 'badge-dm' : 'badge-group'}`
        badge.textContent = recipientLabel
        meta.appendChild(badge)
    }

    meta.appendChild(time)

    const body = document.createElement('div')
    body.className = 'message-body'
    body.textContent = msg.text ?? ''
    if (msg.editedAt) {
        const label = document.createElement('span')
        label.className = 'edited-label'
        label.textContent = '(edited)'
        body.appendChild(label)
    }

    const actions = document.createElement('div')
    actions.className = 'message-actions'
    const reactBtn = document.createElement('button')
    reactBtn.className = 'action-btn'
    reactBtn.textContent = '😊'
    reactBtn.title = 'React'
    reactBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        showReactionPicker(msg.id, reactBtn)
    })
    actions.appendChild(reactBtn)

    if (isSelf) {
        const editBtn = document.createElement('button')
        editBtn.className = 'action-btn'
        editBtn.textContent = '✏'
        editBtn.title = 'Edit (or double-click)'
        editBtn.addEventListener('click', () =>
            startInlineEdit(msg.id, body, div.dataset.text ?? ''),
        )
        actions.appendChild(editBtn)

        const delBtn = document.createElement('button')
        delBtn.className = 'action-btn'
        delBtn.textContent = '✕'
        delBtn.title = 'Delete'
        delBtn.addEventListener('click', () =>
            routeChat({ type: 'delete', id: msg.id }, msgRecipients.get(msg.id)),
        )
        actions.appendChild(delBtn)

        body.addEventListener('dblclick', () =>
            startInlineEdit(msg.id, body, div.dataset.text ?? ''),
        )
    }

    div.appendChild(meta)
    div.appendChild(body)
    div.appendChild(actions)

    msgEls.set(msg.id, div)
    messagesEl.appendChild(div)
    messagesEl.scrollTop = messagesEl.scrollHeight
}

function appendSystemMessage(text: string): void {
    const div = document.createElement('div')
    div.className = 'message system'
    const body = document.createElement('div')
    body.className = 'message-body'
    body.textContent = text
    div.appendChild(body)
    messagesEl.appendChild(div)
    messagesEl.scrollTop = messagesEl.scrollHeight
}

function clearTypingForPeer(peerId: string): void {
    if (!typingPeers.has(peerId)) return
    typingPeers.delete(peerId)
    clearTimeout(typingClearTimers.get(peerId))
    typingClearTimers.delete(peerId)
    renderTypingIndicator()
}

function startInlineEdit(msgId: string, bodyEl: HTMLElement, currentText: string): void {
    if (bodyEl.querySelector('.edit-input')) return
    const input = document.createElement('input')
    input.className = 'edit-input'
    input.value = currentText
    const originalHTML = bodyEl.innerHTML
    bodyEl.innerHTML = ''
    bodyEl.appendChild(input)
    input.focus()
    input.select()

    const finish = (save: boolean) => {
        input.removeEventListener('blur', onBlur)
        const newText = input.value.trim()
        if (save && newText && newText !== currentText) {
            routeChat({ type: 'edit', id: msgId, text: newText }, msgRecipients.get(msgId))
        }
        bodyEl.innerHTML = originalHTML
    }
    const onBlur = () => finish(false)
    input.addEventListener('blur', onBlur)
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            finish(true)
        }
        if (e.key === 'Escape') {
            e.preventDefault()
            finish(false)
        }
    })
}

function showReactionPicker(msgId: string, anchorEl: HTMLElement): void {
    document.getElementById('__rpicker')?.remove()
    const picker = document.createElement('div')
    picker.id = '__rpicker'
    picker.className = 'reaction-picker'
    const rect = anchorEl.getBoundingClientRect()
    picker.style.top = `${Math.max(8, rect.top - 48)}px`
    picker.style.left = `${rect.left}px`
    for (const emoji of REACTIONS) {
        const btn = document.createElement('button')
        btn.textContent = emoji
        btn.addEventListener('click', () => {
            const localPeerId = currentRoom?.localPeerId ?? ''
            const hasReacted = reactionState.get(msgId)?.get(emoji)?.has(localPeerId) ?? false
            routeChat(
                { type: 'reaction', msgId, emoji, action: hasReacted ? 'remove' : 'add' },
                msgRecipients.get(msgId),
            )
            picker.remove()
        })
        picker.appendChild(btn)
    }
    document.body.appendChild(picker)
    const dismiss = (e: MouseEvent) => {
        if (!picker.contains(e.target as Node)) {
            picker.remove()
            document.removeEventListener('click', dismiss, true)
        }
    }
    setTimeout(() => document.addEventListener('click', dismiss, true), 0)
}
