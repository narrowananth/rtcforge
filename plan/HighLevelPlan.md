# RTCForge

> **Build real-time applications without reinventing infrastructure**
>
> *Forge your own real-time infrastructure.*

---

## Overview

**RTCForge** is an open-source, developer-first **npm library** for building real-time communication systems on top of WebRTC.

You install it. You build your own application with it.

It provides high-level abstractions so developers never touch raw WebRTC, SDP, ICE, or mediasoup internals directly.

It provides composable packages to build:

* Video & Voice applications
* Interactive live streaming platforms
* Collaboration tools (whiteboard, chat)
* Broadcast & recording systems

---

## How It Works

RTCForge is consumed as npm packages inside **your own Node.js project**.

```bash
npm install @rtcforge/signaling @rtcforge/media
```

You import the classes, configure them, and build your application on top.
RTCForge handles all WebRTC complexity internally. You only work with high-level abstractions.

> There is no RTCForge server to clone or run. You bring your own Node.js project.

---

## Layer Model

RTCForge is built in layers. Developers only interact with Layer 3 (High-Level Abstractions).

```
┌─────────────────────────────────────────────────────┐
│  Layer 4 — Outer World                              │
│  Client Browser / App (via @rtcforge/sdk)           │
│  Infrastructure (TURN, Storage, Messaging)          │
└─────────────────────────────────────────────────────┘
                        ↕ WebSocket / WebRTC / Config
┌─────────────────────────────────────────────────────┐
│  Layer 3 — High-Level Abstractions  ← YOU ARE HERE  │
│  SignalingServer, Room, Peer                        │
│  MediaService, RecordingService, StreamingService   │
│  ChatService, PresenceService, WhiteboardService    │
└─────────────────────────────────────────────────────┘
                        ↕ internal wiring
┌─────────────────────────────────────────────────────┐
│  Layer 2 — RTCForge Internal                        │
│  WebSocket protocol, SDP/ICE handling               │
│  mediasoup Worker Pool, Transport management        │
│  JWT validation, Room state machine                 │
└─────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────┐
│  Layer 1 — Raw Internals (hidden from developer)    │
│  mediasoup, WebRTC, ws, FFmpeg                      │
└─────────────────────────────────────────────────────┘
```

---

## High-Level Abstractions Per Feature

This is the core of RTCForge — every feature exposes a clean, high-level API.
Developers never touch SDP, ICE candidates, mediasoup transports, or worker processes.

---

### Signaling — `@rtcforge/signaling`

Rooms are created **on-demand** — automatically when the first client joins.
The developer listens to `roomCreated` and configures each room there.

```js
import { SignalingServer } from '@rtcforge/signaling'

const server = new SignalingServer({
  port: 3000,
  auth: async (token) => {
    // your JWT verification logic
    return verifyJWT(token) // returns { roomId, peerId, role }
  }
})

// room is auto-created when the first peer joins
server.on('roomCreated', (room) => {
  room.on('peerJoined', (peer) => { console.log(peer.id, 'joined') })
  room.on('peerLeft',   (peer) => { console.log(peer.id, 'left')   })
  room.on('closed',     ()     => { console.log(room.id, 'closed') })
})

server.on('error', (err) => { console.error('Signaling error', err) })

await server.start()
```

**RTCForge handles internally:**
- WebSocket upgrade and connection lifecycle
- JWT validation at handshake
- SDP offer/answer exchange between peers
- ICE candidate trickle
- Room auto-create on first peer join, auto-close when last peer leaves
- Room state machine (creating → active → closing → closed)

---

### Media (Video / Audio) — `@rtcforge/media`

```js
import { MediaService } from '@rtcforge/media'

const media = new MediaService({
  workers: 4,              // number of mediasoup workers (defaults to CPU count)
  turn: {
    urls: 'turn:your-turn-server.com:3478',
    username: 'user',
    credential: 'pass'
  }
})

media.on('error', (err) => { console.error('Media error', err) })

await room.enableMedia(media)

room.on('peerJoined', async (peer) => {
  peer.on('trackPublished', (track) => {
    console.log(peer.id, 'is publishing', track.kind)
  })

  await peer.subscribeAll()  // subscribe this peer to all room tracks
})
```

**RTCForge handles internally:**
- mediasoup Worker Pool management (spawn, load balance, recover crashes)
- WebRTC Transport creation (DTLS, SRTP)
- Producer and Consumer lifecycle
- Codec negotiation and bitrate control
- TURN server wiring from config

---

### Chat — `@rtcforge/chat`

```js
import { ChatService } from '@rtcforge/chat'

const chat = new ChatService(room)

chat.on('message', (msg) => {
  console.log(msg.from, ':', msg.text)
})

chat.on('typing', (peerId) => {
  console.log(peerId, 'is typing...')
})

// send from server side if needed
await chat.send({ from: 'system', text: 'Welcome to the room' })
```

**RTCForge handles internally:**
- WebSocket message routing to room peers
- Message ordering and delivery
- Typing indicator broadcast with debounce

---

### Presence — `@rtcforge/chat`

```js
const presence = room.presence

presence.on('online',  (peer) => { console.log(peer.id, 'came online')  })
presence.on('offline', (peer) => { console.log(peer.id, 'went offline') })

const onlinePeers = presence.getOnline()
```

**RTCForge handles internally:**
- Heartbeat tracking per peer
- Disconnect detection (WebSocket close + timeout)
- Online/offline state broadcast to room

---

### Recording — `@rtcforge/recording`

```js
import { RecordingService } from '@rtcforge/recording'

const recorder = new RecordingService({
  storage: {
    type: 's3',             // or 'minio' or 'local'
    bucket: 'my-recordings',
    region: 'us-east-1',
    accessKeyId: '...',
    secretAccessKey: '...'
  }
})

recorder.on('error',    (err)             => { console.error('Recording failed', err) })
recorder.on('complete', ({ url, duration }) => { console.log('Saved at', url) })

await recorder.start(room, {
  mode: 'composite',        // or 'stream' (record each peer separately)
  format: 'mp4'
})

await recorder.stop()
```

**RTCForge handles internally:**
- mediasoup pipe transport to recording worker
- FFmpeg/GStreamer composite or stream muxing
- File chunking and reassembly
- Upload to configured storage (S3/MinIO/local)

---

### Streaming — `@rtcforge/streaming`

```js
import { StreamingService } from '@rtcforge/streaming'

const streaming = new StreamingService()

// WebRTC → HLS (broadcast)
// HLS viewer count is NOT available here — viewers fetch segments from your
// CDN/web server. That count lives in your infrastructure, not in RTCForge.
await streaming.startHLS(room, {
  outputPath: '/var/hls/room-123',
  segmentDuration: 4
})

// WebRTC → RTMP
await streaming.startRTMP(room, {
  url: 'rtmp://live.twitch.tv/app/YOUR_STREAM_KEY'
})

// WebRTC SFU streaming — consumerCount is known (connected WebRTC peers)
streaming.on('consumerCount', (count) => { console.log(count, 'live viewers') })

streaming.on('error', (err) => { console.error('Stream error', err) })

await streaming.stop()
```

**RTCForge handles internally:**
- mediasoup → FFmpeg pipeline
- HLS segmenting and playlist generation
- RTMP push to external endpoints
- Stream health monitoring
- Consumer count tracking for WebRTC-based streaming (not HLS)

---

### Whiteboard — `@rtcforge/whiteboard`

```js
import { WhiteboardService } from '@rtcforge/whiteboard'

const whiteboard = new WhiteboardService(room)

// receive events from any peer
whiteboard.on('event', (event) => {
  console.log(event.type, event.data)
})

// broadcast an event to all peers
whiteboard.broadcast({ type: 'draw', data: { x: 10, y: 20, color: '#ff0000' } })

// sync initial state to a new peer
whiteboard.sync(currentState)
```

**RTCForge handles internally:**
- WebSocket event broadcast to all room peers
- State snapshot for late joiners
- CRDT-compatible merge hooks (optional, plug your own CRDT library)
- Event ordering and delivery guarantees

---

## How npm Packages Communicate With the Outer World

RTCForge packages have three external communication surfaces:

---

### 1. Client SDK (`@rtcforge/sdk`) — Browser / Node.js

The client SDK is the counterpart to the server packages. It is installed in the developer's frontend.

```js
// In the browser app
import { RTCForgeClient } from '@rtcforge/sdk'

const client = new RTCForgeClient({
  serverUrl: 'wss://your-app.com',
  token: 'jwt-token-from-your-auth-server'
})

const room = await client.joinRoom('room-123')

// Media
await room.publishCamera()
room.on('trackAdded', (track, peer) => { /* render video */ })

// Chat
room.chat.send('Hello everyone')
room.chat.on('message', (msg) => { /* display message */ })

// Whiteboard
room.whiteboard.on('event', (e) => { /* render on canvas */ })
room.whiteboard.emit({ type: 'draw', data: ... })
```

**Communication flow:**
```
Browser Client (@rtcforge/sdk)
  ├── WebSocket  →  Your Node.js App  →  @rtcforge/signaling
  └── WebRTC     →  mediasoup SFU     →  @rtcforge/media
```

---

### 2. Infrastructure — via Config Objects

RTCForge packages accept infrastructure config at construction time.
They connect to external services only when you pass the config.
Without config, they work with sensible in-process defaults.

| Service | Where Config Goes | What RTCForge Does With It |
| ------- | ----------------- | -------------------------- |
| TURN server | `MediaService({ turn: ... })` | passed to WebRTC ICE config |
| S3 / MinIO | `RecordingService({ storage: ... })` | uploads recordings after mux |
| RTMP endpoint | `streaming.startRTMP({ url })` | FFmpeg pushes stream to URL |
| HLS output | `streaming.startHLS({ outputPath })` | FFmpeg writes segments to path |

---

### 3. Your Application — via Events and Async API

RTCForge uses Node.js EventEmitter pattern throughout.
Your application listens to events and calls async methods.

```
Your App Code
  ├── listens to  → room.on('peerJoined', ...)
  ├── listens to  → recorder.on('complete', ...)
  ├── calls       → await room.enableMedia(media)
  └── calls       → await recorder.start(room, options)
```

---

## Full Wiring Example

This shows how all packages wire together in one Node.js application.

```js
import http from 'http'
import { SignalingServer } from '@rtcforge/signaling'
import { MediaService }    from '@rtcforge/media'
import { ChatService }     from '@rtcforge/chat'
import { RecordingService } from '@rtcforge/recording'

const httpServer = http.createServer(myExpressApp)

// 1. Signaling — attach to your HTTP server
const signaling = new SignalingServer({
  server: httpServer,
  auth: (token) => verifyJWT(token)
})

// 2. Media — configure TURN
const media = new MediaService({
  workers: 4,
  turn: { urls: 'turn:turn.myapp.com:3478', username: 'u', credential: 'p' }
})

// 3. Recording — configure S3
const recorder = new RecordingService({
  storage: { type: 's3', bucket: 'recordings', region: 'us-east-1', ... }
})

// 4. Wire it all together — room is auto-created when first peer joins
signaling.on('roomCreated', async (room) => {

  await room.enableMedia(media)

  const chat = new ChatService(room)
  chat.on('message', (msg) => saveToDatabase(msg))
  chat.on('error',   (err) => console.error('Chat error', err))

  room.on('peerJoined', async (peer) => {
    await peer.subscribeAll()
  })

  // auto-record every room
  await recorder.start(room, { mode: 'composite', format: 'mp4' })
  recorder.on('complete', ({ url }) => saveRecordingUrl(url))
  recorder.on('error',    (err) => console.error('Recording error', err))

  // room closed when last peer leaves — clean up
  room.on('closed', () => {
    recorder.stop().catch(console.error)
  })
})

httpServer.listen(3000)
```

---

## Infrastructure Model

RTCForge is **infrastructure-agnostic**.

It does NOT provide hosted services.

Infrastructure is externally managed by the developer:

* STUN/TURN servers (coturn)
* Redis (optional — for operator-level scale-out only)
* Messaging system (NATS/Kafka)
* Storage (S3/MinIO)

RTCForge connects to these via config objects. Without any config it still works — in-memory, single instance.

---

## Responsibility Model

### RTCForge Provides

* High-level abstraction classes for every real-time feature
* `@rtcforge/signaling` — `SignalingServer`, `Room`, `Peer`
* `@rtcforge/media` — `MediaService`, `MediaRouter`, `Producer`, `Consumer`
* `@rtcforge/chat` — `ChatService`, `PresenceService`
* `@rtcforge/recording` — `RecordingService`
* `@rtcforge/streaming` — `StreamingService`
* `@rtcforge/whiteboard` — `WhiteboardService`
* `@rtcforge/auth` — JWT validation helpers
* `@rtcforge/sdk` — Browser + Node.js client SDK
* Detailed documentation for implementing each feature

### You Provide

* Your own Node.js application (the host project)
* Infrastructure (TURN, Redis, Storage, Messaging)
* Auth token issuance (your own auth server)
* Application logic, business rules, UI
* Deployment (Docker/Kubernetes)
* Scaling & monitoring

---

## Vision

> "To become the open standard for building real-time communication systems."

---

## Why RTCForge?

* npm install — no server to clone or run
* Never touch raw WebRTC, SDP, ICE, or mediasoup internals
* Open-source & self-hosted
* No vendor lock-in
* No internal infrastructure dependencies
* Built on WebRTC (low latency)
* Modular & composable packages
* Developer-first API design
* Enterprise-ready architecture

---

## Quick Start (Coming Soon)

```bash
# Your own Node.js project
mkdir my-rtc-app && cd my-rtc-app
npm init -y

# Install what you need
npm install @rtcforge/signaling @rtcforge/media @rtcforge/sdk
```

> Full implementation guide: [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) *(coming soon)*

---

## Package Structure

| Package | Purpose | Phase |
| ------- | ------- | ----- |
| `@rtcforge/signaling` | SignalingServer, Room, Peer, session lifecycle | 1 |
| `@rtcforge/sdk` | Browser + Node.js client SDK | 1 |
| `@rtcforge/auth` | JWT validation helpers, token middleware | 1 |
| `@rtcforge/media` | MediaService, MediaRouter, Worker Pool, Producer, Consumer | 2 |
| `@rtcforge/chat` | ChatService, PresenceService, typing indicators | 4 |
| `@rtcforge/recording` | RecordingService, S3/MinIO upload | 5 |
| `@rtcforge/streaming` | StreamingService, HLS/RTMP pipeline | 6 |
| `@rtcforge/whiteboard` | WhiteboardService, state sync, CRDT hooks | 7 |

---

## High-Level Architecture

```
Your Node.js Application
  │
  ├── @rtcforge/signaling  (SignalingServer attached to your HTTP server)
  │         │
  │         │  WebSocket (signaling, chat, presence, whiteboard events)
  │         ↕
  │    @rtcforge/sdk  (running in Browser / Client App)
  │         │
  │         │  WebRTC media streams
  │         ↕
  ├── @rtcforge/media  (MediaService → mediasoup Workers)
  │         │
  │         ├── Recording Worker  → Storage (S3/MinIO)   ← you manage
  │         └── Stream Egress     → HLS files / RTMP     ← you manage
  │
  └── Config only (no internal dependency):
        TURN server   ← you manage, passed via MediaService config
        Messaging     ← you manage, optional
        Redis         ← you manage, optional (scale-out only)
```

---

## Architecture Philosophy

> **"SFU for media, WebSockets for signaling."**

RTCForge is a **library**, not a server.
Developers work with high-level abstractions — `Room`, `Peer`, `MediaService`.
RTCForge handles all protocol complexity internally.
The signaling layer manages state in-memory. Scaling is an operator concern.

---

## Media Architecture Choices

| Architecture | Usage |
| ------------ | ----- |
| Mesh | 1:1 calls (optional, small scale) |
| MCU | Recording/composition (limited use) |
| SFU | Core architecture (recommended) |
| Cascading SFU | Large rooms, broadcast at scale |

---

## Feature → Architecture Mapping

| Feature | Architecture | Package |
| ------- | ------------ | ------- |
| 1:1 Video Call | Mesh / SFU | `@rtcforge/media` |
| Group Video Call | SFU | `@rtcforge/media` |
| Voice Chat | SFU | `@rtcforge/media` |
| Screen Sharing | SFU | `@rtcforge/media` |
| Chat | WebSocket | `@rtcforge/chat` |
| Presence | WebSocket | `@rtcforge/chat` |
| Recording | SFU + Worker | `@rtcforge/recording` |
| Interactive Live Streaming | SFU | `@rtcforge/streaming` |
| Broadcast Streaming | Cascading SFU + HLS | `@rtcforge/streaming` |
| Whiteboard | WebSocket + CRDT | `@rtcforge/whiteboard` |

---

## Tech Stack

### RTCForge Library (what we build)

* Node.js (all packages)
* mediasoup (worker process pool — hidden inside `@rtcforge/media`)
* WebRTC
* ws (WebSocket — hidden inside `@rtcforge/signaling`)
* JWT (pluggable issuer — hidden inside `@rtcforge/auth`)

### User's Infrastructure (they manage)

* STUN/TURN (coturn)
* Redis (optional, scale-out only)
* Kafka / NATS (optional, event streaming)
* S3 / MinIO (storage)
* Docker / Kubernetes

---

## mediasoup Worker Architecture

mediasoup runs as separate worker processes. `@rtcforge/media` abstracts this entirely.

* **Worker pool** — one worker per CPU core (configurable via `workers` option)
* **Load balancing** — producers/consumers distributed across workers by load
* **Worker crash recovery** — failed worker detected, peers reassigned automatically
* **Router-to-worker binding** — each Room's router is pinned to one worker

The developer never creates or manages workers. They only call `room.enableMedia(mediaService)`.

---

## Auth Design

* RTCForge validates tokens — it does NOT issue them
* Developers bring their own auth server (any JWT-compatible issuer)
* Token carries: `roomId`, `peerId`, `role` (host/participant/viewer), `expiry`
* Validation runs at WebSocket upgrade — rejected tokens never allocate room state
* Auth hook is a plain async function — return the decoded payload or throw

---

## SDK Priority

| SDK | Priority | Phase |
| --- | -------- | ----- |
| JavaScript (Node.js + Browser) | Primary | Phase 1 |
| Java | Secondary | Phase 8 |
| React Native | Future | Post Phase 8 |
| Flutter | Future | Post Phase 8 |

---

## Repository Structure

```
rtcforge/                          ← monorepo (npm workspaces)
 ├── packages/
 │    ├── signaling/               # @rtcforge/signaling
 │    ├── media/                   # @rtcforge/media
 │    ├── chat/                    # @rtcforge/chat
 │    ├── recording/               # @rtcforge/recording
 │    ├── streaming/               # @rtcforge/streaming
 │    ├── whiteboard/              # @rtcforge/whiteboard
 │    ├── auth/                    # @rtcforge/auth
 │    └── sdk/                     # @rtcforge/sdk (browser + Node.js client)
 │
 ├── examples/                     ← sample apps (not published)
 │    ├── video-call-app/
 │    ├── live-stream-app/
 │    └── whiteboard-app/
 │
 ├── docs/
 └── cli/
```

---

## Key Lifecycle & Behavior Decisions

These are design decisions that every developer using RTCForge needs to understand.

---

### Room Lifecycle

Rooms are created and destroyed automatically — the developer never calls `createRoom()` or `deleteRoom()`.

```
First peer joins a room ID  →  room auto-created  →  'roomCreated' event fires
Last peer leaves            →  room auto-closed   →  'closed' event fires on room
```

Room state exists only in-memory. If the server restarts, all rooms are gone.
Room persistence (saving room history to a database) is the developer's responsibility.

---

### Error Events

Every RTCForge service emits an `error` event for failures. Always listen to it.

| Service | What triggers `error` |
| ------- | --------------------- |
| `SignalingServer` | WebSocket server failure, unhandled auth exception |
| `MediaService` | Worker crash (after recovery attempt fails) |
| `RecordingService` | FFmpeg failure, storage upload failure |
| `StreamingService` | FFmpeg pipeline failure, RTMP disconnect |
| `ChatService` | Message delivery failure |

If you do not listen to `error`, Node.js will throw an unhandled exception and crash your process.

---

### Peer Reconnection

When a client disconnects (network drop, browser refresh) and reconnects:

* The client reconnects to the same room using the same `peerId` in the JWT token
* `@rtcforge/signaling` detects the reconnect and re-attaches the peer to the existing room
* Media tracks are **not** automatically restored — the client re-publishes after reconnect
* The `peerJoined` event fires again on reconnect (treat it as a fresh join)
* If the room was already closed (all other peers left), the reconnecting peer creates a new room

The client SDK (`@rtcforge/sdk`) handles reconnection automatically with exponential backoff.

---

## Roadmap

### Phase 1 — Signaling + Client SDK

* `@rtcforge/signaling` — `SignalingServer`, `Room`, `Peer`
* `@rtcforge/auth` — JWT validation hook
* `@rtcforge/sdk` — Browser + Node.js client SDK
* In-memory room & session lifecycle
* Peer discovery and connection management
* Example app: basic signaling demo
* Published to npm

---

### Phase 2 — Media Package

* `@rtcforge/media` — `MediaService`, `MediaRouter`, `Producer`, `Consumer`
* Worker pool management (spawn, balance, recover)
* 1:1 and group video/audio calls
* Screen sharing
* TURN server wiring via config
* Example app: group video call

---

### Phase 3 — Reliability & Observability

* Structured logging helpers across all packages
* Metrics hooks (Prometheus-compatible)
* Graceful shutdown and reconnection handling
* Health check utilities

---

### Phase 4 — Chat & Presence Package

* `@rtcforge/chat` — `ChatService`, `PresenceService`
* Real-time chat (1:1 & group)
* Presence (online/offline, join/leave events)
* Typing indicators

---

### Phase 5 — Recording Package

* `@rtcforge/recording` — `RecordingService`
* Stream-based and composite recording
* S3/MinIO upload pipeline
* Recording lifecycle API (start/stop/status/complete)

---

### Phase 6 — Streaming Package

* `@rtcforge/streaming` — `StreamingService`
* WebRTC → HLS pipeline
* RTMP egress
* Host/audience role model

---

### Phase 7 — Collaboration Package

* `@rtcforge/whiteboard` — `WhiteboardService`
* State sync and CRDT-compatible hooks
* Event broadcasting
* Late-joiner state sync

---

### Phase 8 — Ecosystem & DX

* Plugin system
* CLI tools (`rtcforge init`, `rtcforge dev`)
* Java SDK
* Mobile SDK (React Native / Flutter)
* Documentation site
* E2E encryption hooks (healthcare / EdTech compliance)

---

### Phase 9 — Scale

* Cascading SFU classes for large rooms
* Multi-region routing patterns
* SFU cluster management
* Operator guide: scale-out patterns
* Bandwidth estimation and congestion control

---

## Target Use Cases

* Video conferencing platforms
* Live streaming applications
* EdTech platforms
* Telemedicine systems
* Real-time collaboration tools

---

## Open Source Strategy

* Core packages → Open Source (MIT/Apache)
* Plugins → Community-driven
* Hosted platform → Future monetization

---

## Key Design Principles

* RTCForge is a library — users build applications, not run RTCForge
* Developers never touch raw WebRTC, SDP, ICE, or mediasoup internals
* RTCForge has zero internal infrastructure dependencies
* Auth is not optional — validate at the signaling boundary
* Signaling state is in-memory; scaling is an operator concern
* JavaScript is the primary SDK — Java and Mobile follow later
* Each package is independent and installable separately
* Prefer event-driven API design throughout
* Focus on developer experience above all else

---

## Final Thought

> RTCForge is not just a library — it is a **foundation for building real-time systems**.

---

## Contributing

Contributions are welcome!
Please read `CONTRIBUTING.md` before submitting PRs.

---

## License

MIT License (or Apache 2.0)
