# rtcforge

**Build real-time WebRTC apps without reinventing the infrastructure.** One
package gives you the signaling server, the browser/Node client, audio/video
(P2P mesh **and** mediasoup SFU), peer-to-peer file transfer, and multi-node
cluster scaling — behind a small, typed API.

```bash
npm i rtcforge                 # signaling server + client + P2P media + file transfer
npm i rtcforge mediasoup       # add the server-side SFU (mediasoup is an optional peer dep)
```

> **One package, nothing else.** The old `rtcforge-core`, `-sdk`, `-signaling`,
> `-media`, and `-sfu` packages are deprecated — everything is now bundled into
> `rtcforge` and imported from its subpaths. `rtcforge` has no `rtcforge-*`
> dependencies.

- **Full guide (real-world blueprints):** [docs/BUILDING_APPS.md](https://github.com/narrowananth/rtcforge/blob/master/docs/BUILDING_APPS.md)
- **API reference (every class & option):** https://narrowananth.github.io/rtcforge/

---

## Entry points

Import only the surface you need — bundlers tree-shake the rest.

| Import | What you get | Runtime |
| ------ | ------------ | ------- |
| `rtcforge/server` | `SignalingServer`, `createSignalingServer`, `Room`, `Peer`, `RoomRouter` | Node |
| `rtcforge/client` | `RTCForgeClient`, `createClient`, `Room`, `ClientEvent`, `RoomEvent` | Browser + Node |
| `rtcforge/media` | `Call`, `getUserMedia`, `MediaEvent` (browser mesh) · `MediaService`, `SfuSignalHandler` (Node SFU) | Browser **and** Node¹ |
| `rtcforge/filetransfer` | `FileTransferManager`, `MemorySink`, `FileSystemAccessSink` | Browser |
| `rtcforge/filetransfer/node` | Node `fs`-backed file sources & sinks | Node |
| `rtcforge/sfu` | `SfuCluster`, `SfuNode`, `HashRingStrategy`, `CascadeTree` | Node |
| `rtcforge/sfu/udp` | `UdpGossipTransport` (multi-host gossip) | Node |
| `rtcforge/core` | `EventEmitter`, `consoleLogger`, `Logger`/`MetricsCollector`, `HashRing`, `GossipMembership` | Any |

¹ `rtcforge/media` resolves to a **mediasoup-free browser build** under a
bundler's `browser` condition (the P2P mesh: `Call`, `getUserMedia`,
`PeerConnection`) and to the **full mediasoup server plane** in Node. You never
ship mediasoup or Node built-ins to the browser.

---

## Mental model

RTCForge is the **transport layer**. It authenticates peers, groups them into
rooms, relays signaling, and moves media. *What the bytes mean* — a chat line, a
cursor, a video frame — is your app.

```
        Browser                         Your server
  ┌──────────────────┐            ┌─────────────────────────┐
  │  rtcforge/client │  WebSocket │   rtcforge/server       │
  │  RTCForgeClient  │◀──────────▶│   SignalingServer       │
  │      Room        │  signaling │   (auth · rooms · relay) │
  └────────┬─────────┘            └───────────┬─────────────┘
           │ feed the Room into…              │ (large rooms)
           ▼                                  ▼
   rtcforge/media (Call)          rtcforge/media (MediaService = SFU)
   P2P mesh, 2–4 peers                     │  fan-out for 5–50+
   rtcforge/filetransfer                   ▼
   direct P2P files              rtcforge/sfu  (multi-node cluster, cascade)
```

Every app is the same three steps: **(1)** run a `SignalingServer`, **(2)**
connect with `RTCForgeClient` and join a `Room`, **(3)** *optionally* add media.
Add a layer only when a real limit forces it — each step is additive, no rewrite.

---

## Quickstart

### 1. Backend — signaling server

```ts
import { createSignalingServer } from 'rtcforge/server'

// createSignalingServer starts with safe defaults on: rate-limit, payload cap,
// connection/room caps, and a warn-level logger.
const server = await createSignalingServer({
  port: 3001,
  // The one integration seam: your token → who the peer is and where it belongs.
  // MUST return roomId + peerId + role (returning only { peerId } rejects everyone).
  auth: async (token) => {
    const user = await myAuth.verify(token)
    return { roomId: user.roomId, peerId: user.id, role: user.role ?? '', metadata: { name: user.name } }
  },
  maxPeersPerRoom: 200,
})
```

### 2. Frontend — connect, join a room, exchange messages

```ts
import { createClient, RoomEvent } from 'rtcforge/client'

const client = createClient({ serverUrl: 'wss://rtc.myapp.com', token })
const room = await client.joinRoom('general') // connects + joins

// PeerJoined / PeerLeft payloads are the peer id string:
room.on(RoomEvent.PeerJoined, (peerId) => showPresence(peerId))
room.on(RoomEvent.PeerLeft,   (peerId) => hidePresence(peerId))

// Application messages ride named channels. One "broadcast" event carries
// (from, channel, data) — filter by channel yourself:
room.broadcast('chat', { text: 'hello', at: Date.now() })
room.on(RoomEvent.Broadcast, (from, channel, data) => {
  if (channel === 'chat') renderMessage(from, data)
})
```

That's a complete real-time app — chat, presence, notifications, collaborative
cursors/whiteboards — no media required.

### 3. Add audio/video — P2P mesh (2–4 peers)

```ts
import { Call, MediaEvent, getUserMedia } from 'rtcforge/media' // browser build, no mediasoup

const stream = await getUserMedia({ audio: true, video: true })
const call = new Call(room, { stream, iceServers: room.iceServers })
room.bindCall(call)  // wire the Room's signal relay ↔ the Call
call.start()

call.on(MediaEvent.RemoteStream, (peerId, remote) => attachVideoEl(peerId, remote))
```

Past ~4 peers, switch the media plane to the server-side SFU (`MediaService` +
`SfuSignalHandler`) — the room/client code above is unchanged. See the guide.

### 4. Peer-to-peer file transfer

Files move **directly between peers** over a WebRTC data channel — chunked,
checksummed, backpressured. The server never sees the bytes.

```ts
import { FileTransferManager, MemorySink, FileTransferEvent } from 'rtcforge/filetransfer'

// `hub` is a DataChannelHub you implement over your RTCPeerConnections — it
// opens/receives data channels for a peer id (the seam that decouples file
// transfer from the media/mesh layer).
const ft = new FileTransferManager(hub, { checksum: true })

// Send:
const transfer = ft.sendFile('peer-42', file /* File | Blob */)
transfer.on('progress', (p) => updateBar(p.ratio))
transfer.on('complete', () => done())

// Receive:
ft.on(FileTransferEvent.IncomingOffer, (incoming) => {
  incoming.accept(new MemorySink()) // or FileSystemAccessSink / a Node fs sink
})
```

---

## Scaling & production (see the [guide](https://github.com/narrowananth/rtcforge/blob/master/docs/BUILDING_APPS.md))

- **Group rooms / webinars (5–50):** `MediaService` mediasoup SFU — each client
  uploads once, the server fans out; client bandwidth stays flat.
- **Massive / multi-region (1000s → 1M viewers):** `rtcforge/sfu` runs many SFU
  nodes as one shared-nothing cluster (gossip via `rtcforge/sfu/udp`, no
  Redis/etcd); `CascadeTree` fans one stream across a tree of relays.
- **Auth & reconnect:** pass `tokenRefresh` on the client so reconnects don't
  force re-login; `reconnect: true` gives backoff + a send queue that replays
  buffered messages.
- **TURN:** mint per-peer credentials in the server's `iceServersHook`; they
  arrive on `room.iceServers`.
- **Observability:** pass a `Logger` + `MetricsCollector` (`rtcforge/core`) into
  the server; consume `auditLog` for join/leave/kick.

---

## Event reference

```ts
import { ClientEvent, RoomEvent } from 'rtcforge/client'

ClientEvent.Connected     // joined + socket open (also re-fires after rejoin)
ClientEvent.Reconnecting  // (attempt: number)
ClientEvent.Disconnected  // (code, reason)
ClientEvent.Terminated    // non-retryable close / reconnect exhausted — you may joinRoom() again
ClientEvent.Error         // (Error)

RoomEvent.PeerJoined      // (peerId)
RoomEvent.PeerLeft        // (peerId)
RoomEvent.Broadcast       // (from, channel, data)
RoomEvent.Signal          // (from, data)  — directed peer-to-peer payload
RoomEvent.PresenceOnline  // (peerId)  — regained connection
RoomEvent.PresenceOffline // (peerId)  — lost connection, not yet left
RoomEvent.Kicked          // (peerId, reason)
RoomEvent.RoleChanged     // (peerId, role)
RoomEvent.Refreshed       // roster replaced after reconnect/rejoin
RoomEvent.Closed          // room no longer usable
```

---

MIT © narrowananth · [GitHub](https://github.com/narrowananth/rtcforge) · [npm](https://www.npmjs.com/package/rtcforge)
