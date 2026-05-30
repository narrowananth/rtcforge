import { PeerEvent, RoomEvent, ServerEvent, SignalingServer } from '@rtcforge/signaling'

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = 3001
const MAX_PEERS_PER_ROOM = 50

// Rate limiting: max messages per peer within the sliding window
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 10_000

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new SignalingServer({
    port: PORT,
    maxPeersPerRoom: MAX_PEERS_PER_ROOM,
})

// ── Per-peer rate limiter ─────────────────────────────────────────────────────

function makeRateLimiter() {
    const timestamps: number[] = []
    return {
        allow(): boolean {
            const now = Date.now()
            // Evict timestamps outside the window
            while (timestamps.length > 0 && (timestamps[0] ?? 0) < now - RATE_LIMIT_WINDOW_MS) {
                timestamps.shift()
            }
            if (timestamps.length >= RATE_LIMIT_MAX) return false
            timestamps.push(now)
            return true
        },
    }
}

// ── Audit log ─────────────────────────────────────────────────────────────────

function audit(event: string, roomId: string, detail: Record<string, unknown> = {}): void {
    const entry = {
        ts: new Date().toISOString(),
        event,
        roomId,
        ...detail,
    }
    console.log(`[audit] ${JSON.stringify(entry)}`)
}

// ── Room lifecycle ────────────────────────────────────────────────────────────

server.on(ServerEvent.RoomCreated, (room) => {
    audit('room.created', room.id)
    console.log(`[room] created: ${room.id}`)

    room.on(RoomEvent.PeerJoined, (peer) => {
        audit('peer.joined', room.id, { peerId: peer.id, role: peer.role })
        console.log(`[room:${room.id}] ${peer.id} joined (role=${peer.role})`)

        const limiter = makeRateLimiter()

        // Wire server-side Broadcast listener for logging
        peer.on(PeerEvent.Broadcast, (channel: string, data: unknown) => {
            if (!limiter.allow()) {
                audit('rate.limited', room.id, { peerId: peer.id, channel })
                console.warn(
                    `[room:${room.id}] rate limit hit for ${peer.id} on channel "${channel}"`,
                )
                return
            }

            if (channel === 'chat') {
                const payload = data as Record<string, unknown>
                switch (payload.type) {
                    case 'message': {
                        const { id, text, to } = payload as {
                            id: string
                            text: string
                            to?: string | string[]
                        }
                        const mode =
                            to === undefined
                                ? 'broadcast'
                                : typeof to === 'string'
                                  ? `dm→${to}`
                                  : `group→[${(to as string[]).join(',')}]`
                        audit('chat.message', room.id, { peerId: peer.id, msgId: id, mode })
                        console.log(
                            `[room:${room.id}] <${peer.id}> [${mode}] ${text ?? '(no text)'}`,
                        )
                        break
                    }
                    case 'edit': {
                        const { id } = payload as { id: string }
                        audit('chat.edit', room.id, { peerId: peer.id, msgId: id })
                        console.log(`[room:${room.id}] ${peer.id} edited message ${id}`)
                        break
                    }
                    case 'delete': {
                        const { id } = payload as { id: string }
                        audit('chat.delete', room.id, { peerId: peer.id, msgId: id })
                        console.log(`[room:${room.id}] ${peer.id} deleted message ${id}`)
                        break
                    }
                    case 'reaction': {
                        const { msgId, emoji, action } = payload as {
                            msgId: string
                            emoji: string
                            action: 'add' | 'remove'
                        }
                        audit('chat.reaction', room.id, {
                            peerId: peer.id,
                            msgId,
                            emoji,
                            action,
                        })
                        console.log(
                            `[room:${room.id}] ${peer.id} ${action === 'add' ? 'reacted' : 'removed reaction'} ${emoji} on ${msgId}`,
                        )
                        break
                    }
                    case 'typing':
                        // Typing is high-frequency — log only at debug level
                        break
                    case 'read': {
                        const { id } = payload as { id: string }
                        audit('chat.read', room.id, { peerId: peer.id, msgId: id })
                        break
                    }
                    default:
                        audit('chat.unknown', room.id, {
                            peerId: peer.id,
                            payloadType: payload.type,
                        })
                        break
                }
            } else {
                audit('broadcast', room.id, { peerId: peer.id, channel })
            }
        })
    })

    room.on(RoomEvent.PeerLeft, (peer) => {
        audit('peer.left', room.id, { peerId: peer.id })
        console.log(`[room:${room.id}] ${peer.id} left`)
    })

    room.on(RoomEvent.Closed, () => {
        audit('room.closed', room.id)
        console.log(`[room:${room.id}] closed`)
    })
})

server.on(ServerEvent.Error, (err) => {
    console.error('[server] error:', err)
})

// ── Start ─────────────────────────────────────────────────────────────────────

await server.start()
console.log(`Signaling server running on ws://localhost:${PORT}`)
console.log(`Max peers per room: ${MAX_PEERS_PER_ROOM}`)
console.log('Press Ctrl+C to stop.\n')

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
        console.log(`\n[server] ${sig} received — shutting down`)
        await server.stop()
        process.exit(0)
    })
}
