import { RoomEvent, ServerEvent, SignalingServer } from '@rtcforge/signaling'
import type { AuthPayload } from '@rtcforge/signaling'

const PORT = 3004
const MAX_VIEWERS = 50

// Simple sliding-window rate limiter: max 20 auth attempts per roomId per second
const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 1_000

function checkRateLimit(roomId: string): boolean {
    const now = Date.now()
    const times = rateLimitMap.get(roomId) ?? []
    const recent = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    recent.push(now)
    rateLimitMap.set(roomId, recent)
    return recent.length <= RATE_LIMIT_MAX
}

async function auth(token: string): Promise<AuthPayload> {
    let decoded: unknown
    try {
        decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'))
    } catch {
        throw new Error('Invalid auth token')
    }

    if (
        typeof decoded !== 'object' ||
        decoded === null ||
        typeof (decoded as Record<string, unknown>).roomId !== 'string' ||
        typeof (decoded as Record<string, unknown>).peerId !== 'string' ||
        typeof (decoded as Record<string, unknown>).role !== 'string'
    ) {
        throw new Error('Invalid auth payload')
    }

    const { roomId, peerId, role } = decoded as { roomId: string; peerId: string; role: string }

    if (role !== 'host' && role !== 'viewer') {
        throw new Error('Invalid role: must be host or viewer')
    }

    if (!checkRateLimit(roomId)) {
        throw new Error('Rate limit exceeded')
    }

    return { roomId, peerId, role } as AuthPayload
}

const server = new SignalingServer({ port: PORT, auth })

server.on(ServerEvent.RoomCreated, (room) => {
    console.log(`[room] created: ${room.id}`)

    let hostPeerId: string | null = null
    const viewers = new Set<string>()

    room.on(RoomEvent.PeerJoined, (peer) => {
        if (peer.role === 'host') {
            if (hostPeerId === null) {
                hostPeerId = peer.id
                console.log(`[room:${room.id}] host set: ${peer.id}`)
            }
        } else if (peer.role === 'viewer') {
            if (viewers.size >= MAX_VIEWERS) {
                console.log(
                    `[room:${room.id}] viewer limit reached (${MAX_VIEWERS}), kicking ${peer.id}`,
                )
                room.kickPeer(peer.id, 'Viewer limit reached')
                return
            }
            viewers.add(peer.id)
            console.log(`[room:${room.id}] viewer joined: ${peer.id} (viewers: ${viewers.size})`)
        }
    })

    room.on(RoomEvent.PeerLeft, (peer) => {
        if (peer.id === hostPeerId) {
            console.log(`[room:${room.id}] host left: ${peer.id} — kicking all viewers`)
            for (const viewerId of [...viewers]) {
                room.kickPeer(viewerId, 'Host disconnected')
            }
            viewers.clear()
            hostPeerId = null
            console.log(`[room:${room.id}] all viewers cleared`)
        } else if (viewers.has(peer.id)) {
            viewers.delete(peer.id)
            console.log(`[room:${room.id}] viewer left: ${peer.id} (viewers: ${viewers.size})`)
        }
    })

    room.on(RoomEvent.Closed, () => {
        console.log(`[room:${room.id}] closed`)
    })
})

server.on(ServerEvent.Error, (err) => {
    console.error('[server] error:', err)
})

await server.start()
console.log(`Live stream signaling server running on ws://localhost:${PORT}`)
console.log('Press Ctrl+C to stop.\n')

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
        console.log(`\n[server] ${sig} received — shutting down`)
        await server.stop()
        process.exit(0)
    })
}
