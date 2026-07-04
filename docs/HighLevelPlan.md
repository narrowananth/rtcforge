# RTCForge

> **Build real-time applications without reinventing infrastructure**
>
> *Forge your own real-time infrastructure.*

> ⚠️ **This is the original design/vision document.** It predates the shipped
> layout and uses planning-era `@rtcforge/*` scoped names and a multi-package
> split. **What actually shipped:** a **single published package, `rtcforge`**,
> that bundles every module and exposes them via subpaths — `rtcforge/server`,
> `/client`, `/media` (mediasoup-free `browser` build + node SFU), `/filetransfer`
> (+ `/node`), `/sfu` (+ `/udp`), `/core`. `mediasoup` is an optional peer
> dependency. The old `rtcforge-core`/`-sdk`/`-signaling`/`-media`/`-sfu` packages
> are deprecated. For accurate install/usage see [`../README.md`](../README.md),
> [`PUBLISHING.md`](PUBLISHING.md), and [`BUILDING_APPS.md`](BUILDING_APPS.md).

---

## Overview

**RTCForge** is an open-source, developer-first **npm library** for building on top of WebRTC.

It is a **pure WebRTC transport layer** — not an application framework.

RTCForge ships as two distinct layers, and the boundary between them is the single most important concept in this document:

| Layer | Owner | What it is |
| ----- | ----- | ---------- |
| **Core Layer** (abstract) | RTCForge | The abstract transport substrate: signaling, room/peer lifecycle, mesh + SFU media plane, scale-out, client SDK. Stable primitives and events. |
| **Application Layer** (concrete) | You | Everything you build on the primitives: chat, presence, whiteboard, recording, streaming egress, business logic, UI, auth issuance. |

RTCForge handles the hard parts of WebRTC so developers never touch raw SDP, ICE, DTLS, or mediasoup internals:

* Signaling, room and peer lifecycle, auth
* Peer-to-peer mesh calls (1:1, small groups)
* SFU routing, producer/consumer media plane
* SFU cluster, cascading routers, multi-node scale-out
* Browser client SDK (WebRTC session management)

Application-level features (chat, presence, whiteboard, recording, streaming logic) live in **your application layer** — built on top of RTCForge's transport primitives. RTCForge does **not** ship abstract base classes or plugins for these; it exposes the transport events and media handles you compose them from.

---

## How It Works

RTCForge is consumed as npm packages inside **your own Node.js project**.

```bash
npm i rtcforge            # shipped name (add `mediasoup` for the SFU media plane)
```

You import the classes, configure them, and build your **application layer** on top.
RTCForge's **core layer** handles all WebRTC complexity internally. You only work with high-level abstractions.

> There is no RTCForge server to clone or run. You bring your own Node.js project.

---

## Layer Model

```
┌─────────────────────────────────────────────────────┐
│  APPLICATION LAYER   ← YOU IMPLEMENT THIS            │
│  Chat, presence, whiteboard, recording, streaming   │
│  Business logic, UI, auth token issuance            │
└─────────────────────────────────────────────────────┘
                        ↕ Events / Async API  (the boundary)
┌─────────────────────────────────────────────────────┐
│  CORE LAYER (RTCForge) — WebRTC Transport            │
│                                                     │
│  @rtcforge/signaling  — SignalingServer, Room, Peer  │
│  @rtcforge/media      — MediaService, MediaRouter   │
│                         Producer, Consumer           │
│                         PeerConnection (mesh)        │
│  @rtcforge/sfu        — SfuNode, SfuCluster         │
│                         CascadingRouter, SfuBridge   │
│  @rtcforge/sdk        — RTCForgeClient (browser)    │
│  @rtcforge/core       — EventEmitter, Logger        │
└─────────────────────────────────────────────────────┘
                        ↕ internal
┌─────────────────────────────────────────────────────┐
│  Raw Internals (hidden from developer)              │
│  mediasoup, WebRTC, ws                              │
└─────────────────────────────────────────────────────┘
```

**The core layer stops at the transport boundary. Everything above it is your application layer.**
The contract between them is event-driven: the core layer emits lifecycle/media events and hands you media handles; your application layer subscribes and builds features.

---

## What the Core Layer Provides

---

### Signaling — `@rtcforge/signaling`

Rooms are created **on-demand** — automatically when the first client joins.

Auth validation is built into `SignalingServer` via the `auth` option. Pass any async function that verifies your token.

```js
import { SignalingServer } from '@rtcforge/signaling'
import jwt from 'jsonwebtoken'

const server = new SignalingServer({
  port: 3000,
  auth: async (token) => {
    return jwt.verify(token, process.env.JWT_SECRET)
    // must return: { roomId, peerId, role }
  }
})

server.on('roomCreated', (room) => {
  room.on('peerJoined', (peer) => { console.log(peer.id, 'joined') })
  room.on('peerLeft',   (peer) => { console.log(peer.id, 'left')   })
  room.on('closed',     ()     => { console.log(room.id, 'closed') })
})

server.on('error', (err) => { console.error('Signaling error', err) })

await server.start()
```

**Core layer handles internally:**
- WebSocket upgrade and connection lifecycle
- JWT validation at handshake
- SDP offer/answer exchange between peers
- ICE candidate trickle
- Room auto-create on first peer join, auto-close when last peer leaves
- Room state machine (creating → active → closing → closed)

**The events it hands your application layer:** `roomCreated`, `peerJoined`, `peerLeft`, `closed`, `error`.

---

### Media — `@rtcforge/media`

Two modes: **Mesh** (direct P2P) and **SFU** (server-routed via mediasoup).

**Mesh — `PeerConnection` and `Call`:**

```js
import { PeerConnection } from '@rtcforge/media'

// PeerConnection uses Perfect Negotiation — pass the politeness role + options.
// Offers are produced automatically via `onnegotiationneeded`, not a manual createOffer().
const pc = new PeerConnection(polite, { iceServers: [...] })
```

> Both the mesh path (`PeerConnection`, `Call`) and the SFU path below are fully implemented — the SFU is backed by a real mediasoup worker pool.

**SFU — `MediaService` and `MediaRouter`:**

```js
import { MediaService } from '@rtcforge/media'

const mediaService = new MediaService({ logger })
await mediaService.init() // spawn the mediasoup worker pool (once)

server.on('roomCreated', async (room) => {
  const router = await mediaService.attachRoom(room) // wraps a real mediasoup Router

  // Drive produce/consume from the browser (mediasoup-client) over your wire protocol:
  //   router.rtpCapabilities → createWebRtcTransport → connectTransport → produce / consume → resumeConsumer
  router.on('producerAdded', (producer) => {
    // a peer published a track
  })
})

mediaService.on('error', (err) => { console.error('Media error', err) })
```

**Core layer handles internally:**
- mediasoup Worker Pool management (spawn one per CPU, least-loaded router assignment, respawn on crash)
- WebRTC Transport creation (ICE/DTLS/SRTP)
- Producer and Consumer lifecycle (paused-consumer best practice, producer→consumer cascade close)
- Codec negotiation (Opus/VP8/H264 defaults) and bitrate control
- Peer cleanup on leave (closes the peer's transports → cascades), router close on room close

**The handles it hands your application layer:** `Producer`, `Consumer`, `MediaRouter` (with `rtpCapabilities`, `createWebRtcTransport`, `connectTransport`, `produce`, `consume`, `resumeConsumer`, and pipe bridging — `pipeProducerTo` / `createPipeTransport` / `connectPipeTransport` / `pipeConsume` / `pipeProduce`), plus `producerAdded` / `consumerAdded` events — the raw material for recording, streaming egress, and screen-share features.

> **Implementation Status — SFU media plane is real (mediasoup-backed).** `MediaService` owns a mediasoup `WorkerPool`; `attachRoom` creates one mediasoup `Router` per room; `MediaRouter` exposes the full produce/consume signalling surface; `Producer`/`Consumer` wrap real mediasoup entities. Verified by integration tests that spawn a live worker. **Remaining (application layer):** the browser side uses `mediasoup-client` and an app-defined wire protocol to carry `rtpCapabilities` / transport params / produce / consume between client and `MediaRouter` — RTCForge provides the server engine and the method surface, you provide the signalling glue.

---

### SFU Scale-Out — `@rtcforge/sfu`

For large deployments: multi-node SFU clusters, cascading routers, and cross-node bridges.

```js
import { SfuCluster, CascadingRouter } from '@rtcforge/sfu'

const cluster = new SfuCluster({ logger })
cluster.addNode(node) // nodes are registered via addNode(), not a constructor option

// CascadingRouter fans out from one SFU node to others
const cascader = new CascadingRouter(cluster, { logger })
```

**Core layer handles internally:**
- SFU node registry and health tracking
- Cascading fan-out for large rooms
- Bandwidth estimation hooks (`SimpleBandwidthEstimator`)

> **Implementation Status.** Node registry, health tracking (emits `error` on node failure), least-loaded assignment (pluggable via `PlacementStrategy`), cascading fan-out, and the bandwidth estimator are real. `SfuBridge` is the **control-plane signal** — it tells the media plane *when* to bridge (route assignments to a host-supplied adapter), with best-effort error-guarded teardown. The **media-plane bridging engine is implemented** in `@rtcforge/media`: same-host cross-worker piping (`MediaService.pipeProducerToRoom` / `MediaRouter.pipeProducerTo`, via mediasoup `pipeToRouter`) and the cross-host `PipeTransport` primitives (`createPipeTransport`/`connectPipeTransport`/`pipeConsume`/`pipeProduce`) — verified end-to-end against real workers. **Remaining (application layer):** for cross-machine bridging you ship the exchanged pipe-transport params between node processes over your own control channel (same shape as the client wire-protocol glue).

---

### Client SDK — `@rtcforge/sdk`

Browser-side WebRTC session management. Counterpart to the server packages.

```js
import { RTCForgeClient } from '@rtcforge/sdk'

const client = new RTCForgeClient({
  serverUrl: 'wss://your-app.com',
  token: 'jwt-token-from-your-auth-server'
})

const room = await client.joinRoom('room-123')

// Media — subscribing. Event is 'track-added' with (track, streams, peerId).
// Tracks only flow once a media plane (CallInterface) is bound to the room.
room.on('track-added', (track, streams, peerId) => { /* render video */ })
```

**Communication flow:**
```
Browser Client (@rtcforge/sdk)
  ├── WebSocket  →  Your Node.js App  →  @rtcforge/signaling
  └── WebRTC     →  mediasoup SFU     →  @rtcforge/media
```

---

## The Two-Layer Split, Per Feature

Every real-time feature decomposes into a **Core Layer** half (transport — RTCForge gives you) and an **Application Layer** half (concrete logic — you implement). This is the central table of the whole project.

| Feature | Core Layer provides (abstract transport) | Application Layer implements (concrete) |
| ------- | ---------------------------------------- | --------------------------------------- |
| 1:1 Video Call | `PeerConnection` / `Call` mesh, signaling, ICE/DTLS | Call UI, ringing/invite flow, call state |
| Group Video Call | `MediaService`, `MediaRouter`, Producer/Consumer | Grid layout, active-speaker logic, mute UX |
| Voice Chat | SFU audio routing, codec negotiation | Push-to-talk, volume UI, audio-only rooms |
| Screen Sharing | `getDisplayMedia()` capture + Producer publish | Share toggle UI, "who is sharing" state |
| Chat / Messaging | DataChannel + signaling WebSocket transport | Message model, history/persistence, threads |
| Presence / Online status | `peerJoined` / `peerLeft` room events | Presence store, status badges, away/idle logic |
| Whiteboard / Collaboration | DataChannel broadcast transport | Canvas, CRDT/OT merge, drawing tools |
| Recording | `MediaStream` from `Consumer` (server) / browser | `MediaRecorder` pipeline, encoding, S3 upload |
| Live streaming (HLS/RTMP) | Raw WebRTC stream from SFU | FFmpeg transcode pipeline, egress, CDN |
| Large Room / Broadcast | `SfuCluster`, `CascadingRouter` fan-out | Audience UX, viewer scaling policy |
| Multi-node federation | `SfuBridge` cross-node track forwarding | Region selection, routing policy |

**Read every row left-to-right:** RTCForge delivers the media and signaling transport on the left. The concrete feature on the right is yours. RTCForge ships no abstract `ChatService`, `Whiteboard`, or `Recorder` class — it deliberately stops at the transport boundary so your application layer stays unconstrained.

---

## Full Wiring Example

This is the seam between the two layers in code — core layer constructed, application layer hung off its events.

```js
import http from 'http'
import { SignalingServer } from '@rtcforge/signaling'
import { MediaService }    from '@rtcforge/media'

const httpServer = http.createServer(myExpressApp)

// 1. CORE LAYER — Signaling, attached to your HTTP server
const signaling = new SignalingServer({
  server: httpServer,
  auth: (token) => verifyJWT(token)
})

// 2. CORE LAYER — Media (mediasoup). Configure workers / codecs / listen IPs here.
const mediaService = new MediaService({ logger })
await mediaService.init() // spawn the worker pool before the server accepts rooms

// 3. THE BOUNDARY — wire media to each room as it's created
signaling.on('roomCreated', async (room) => {
  const router = await mediaService.attachRoom(room)

  // 4. APPLICATION LAYER — your concrete features live here
  router.on('producerAdded', (producer) => {
    // build your own fan-out / recording / streaming logic,
    // or let @rtcforge/sfu handle fan-out at scale
  })
})

mediaService.on('error', (err) => { console.error('Media error', err) })

httpServer.listen(3000)
```

---

## Infrastructure Model

RTCForge is **infrastructure-agnostic**. It does NOT provide hosted services.

The infrastructure RTCForge touches:

* **SFU listen / announced IPs** — the addresses clients connect to, set via `MediaService`'s `webRtcTransport.listenInfos`. Defaults to localhost; set your public IP / `announcedAddress` in production.
* **STUN/TURN servers (coturn)** — a *client* ICE concern. You hand them to clients via the signaling `iceServersHook` (or `CallOptions.iceServers` on the mesh path). RTCForge relays them; it does not host them.

Anything else (storage, messaging, queues, egress) is entirely your application's concern — RTCForge neither requires nor references it.

---

## Responsibility Model

### Core Layer — RTCForge Provides

* `@rtcforge/core` — EventEmitter, Logger, noopLogger, MetricsCollector, noopMetrics, Metric, toError, **HashRing, GossipMembership, Membership, Clock, StateStore, MessageBus, Lock, IdGenerator** — zero dependencies
* `@rtcforge/signaling` — SignalingServer, Room, Peer, session lifecycle, built-in auth hook, **RoomRouter (cluster sharding)**
* `@rtcforge/media` — MediaService, MediaRouter, SfuSignalHandler, Producer, Consumer, WorkerPool (mediasoup — **optional peer dep**), PeerConnection (mesh), MediaManager
* `@rtcforge/sfu` — SfuNode, SfuCluster, CascadingRouter, SfuBridge, SimpleBandwidthEstimator, ReferenceSfuMedia, **HashRingStrategy, CascadeTree, CascadeBridge**; gossip wire at `rtcforge-sfu/udp`
* `@rtcforge/sdk` — Browser + Node.js client SDK
* `@rtcforge/adapter-udp` — **deprecated**, re-exports `rtcforge-sfu/udp` (`UdpGossipTransport`)

### Application Layer — You Provide

* Your own Node.js application (the host project)
* A STUN/TURN server for NAT traversal — handed to clients via the signaling `iceServersHook` (the SFU's own listen/announced IPs go in `MediaService`'s `webRtcTransport` config)
* Auth token issuance (your own auth server)
* Application features: chat, presence, whiteboard, recording, streaming egress
* Application logic, business rules, UI

---

## Vision

> "To become the open standard for WebRTC infrastructure."

---

## Why RTCForge?

* npm install — no server to clone or run
* Never touch raw WebRTC, SDP, ICE, or mediasoup internals
* Clean two-layer split — stable core transport, unconstrained application layer
* Open-source & self-hosted
* No vendor lock-in
* No internal infrastructure dependencies
* Built on WebRTC (low latency)
* Modular & composable packages
* Developer-first API design
* Enterprise-ready architecture

---

## Quick Start

```bash
# Your own Node.js project
mkdir my-rtc-app && cd my-rtc-app
npm init -y

# Install what you need (shipped names)
npm i rtcforge            # or cherry-pick: rtcforge-signaling rtcforge-sdk rtcforge-media
```

---

## Package Structure (Core Layer)

> Shipped names are unscoped (drop the `@` and slash: `@rtcforge/core` → `rtcforge-core`), fronted by the `rtcforge` meta-package.

| Package (shipped name) | Purpose | Status |
| ------- | ------- | ------ |
| `rtcforge` | One-install meta-package — subpaths `rtcforge/client`, `/server`, `/media`, `/filetransfer` | ✅ Done |
| `rtcforge-core` | Shared primitives: EventEmitter, Logger, consoleLogger, noopLogger, MetricsCollector, noopMetrics, Metric, toError — **plus shared-nothing scale primitives**: HashRing, GossipMembership (SWIM), Membership, Clock, StateStore, MessageBus, Lock, IdGenerator (interfaces + in-memory/pure defaults) — zero dependencies | ✅ Done |
| `rtcforge-signaling` | SignalingServer (+ `createSignalingServer`), Room, Peer, session lifecycle, auth hook, safe defaults on, **`RoomRouter` cluster routing** | ✅ Done |
| `rtcforge-media` | PeerConnection (mesh), MediaService, MediaRouter, SfuSignalHandler, Producer, Consumer, WorkerPool — **`mediasoup` is an optional peer dep** | ✅ Mesh · ✅ SFU (mediasoup-backed) |
| `rtcforge-sfu` | SfuNode, SfuCluster, CascadingRouter, SfuBridge, `HashRingStrategy`, `CascadeTree`/`CascadeBridge`, `ReferenceSfuMedia`, bandwidth estimation; gossip wire at `rtcforge-sfu/udp` | ✅ Cluster/cascading/estimator + `error` event · ✅ media-plane pipe bridging engine · ✅ shared-nothing placement + 1M-viewer fan-out tree |
| `rtcforge-sdk` | Browser + Node.js client SDK (+ `createClient`, `/filetransfer`) | ✅ Done |
| `rtcforge-adapter-udp` | **Deprecated** — re-exports `rtcforge-sfu/udp` (`UdpGossipTransport`) | ⚠️ Deprecated |

---

## High-Level Architecture

```
Your Node.js Application  ← APPLICATION LAYER
  │
  ├── @rtcforge/signaling  (SignalingServer attached to your HTTP server)   ┐
  │         │                                                               │
  │         │  WebSocket (signaling, session lifecycle)                     │
  │         ↕                                                               │
  │    @rtcforge/sdk  (running in Browser / Client App)                     │  CORE
  │         │                                                               │  LAYER
  │         │  WebRTC media streams                                         │
  │         ↕                                                               │
  ├── @rtcforge/media  (MediaService → MediaRouter → Producer / Consumer)   │
  │         │                                                               │
  │         └── @rtcforge/sfu (SfuCluster → CascadingRouter for scale-out)  ┘
  │
  └── Config only (no internal dependency):
        SFU listen IPs ← MediaService `webRtcTransport.listenInfos`
        STUN/TURN      ← you manage, handed to clients via signaling `iceServersHook`
```

---

## Architecture Philosophy

> **"SFU for media, WebSockets for signaling."**

RTCForge is a **library**, not a server.
Developers work with high-level core-layer abstractions — `Room`, `Peer`, `MediaService`, `SfuCluster` — and build their application layer on the events those emit.
RTCForge handles all protocol complexity internally.
A single signaling instance manages room state in-memory. Horizontal scale-out is **shared-nothing and built in** — `RoomRouter` + `HashRing` shard rooms across a gossip-discovered fleet (`GossipMembership`), with **no Redis/etcd/central store**. Operators inject one socket adapter (`@rtcforge/adapter-udp`) and the host fleet; the routing math is a pure function shipped in `@rtcforge/core`.

---

## Media Architecture Choices

| Architecture | Usage |
| ------------ | ----- |
| Mesh | 1:1 calls (small scale) |
| SFU | Core architecture (recommended) |
| Cascading SFU | Large rooms, broadcast at scale |

---

## Tech Stack

### Core Layer (RTCForge Library)

* Node.js (all packages)
* mediasoup (worker process pool — hidden inside `@rtcforge/media`)
* WebRTC
* ws (WebSocket — hidden inside `@rtcforge/signaling`)
* JWT validation — built into `@rtcforge/signaling` auth hook (developer brings own JWT library)

### Application Layer (Your Infrastructure)

* STUN/TURN (coturn)

---

## mediasoup Worker Architecture

mediasoup runs as separate worker processes. `@rtcforge/media` abstracts this entirely.

* **Worker pool** — one worker per CPU core (configurable via `worker.numWorkers`)
* **Load balancing** — each new room's router is assigned to the least-loaded worker
* **Worker crash recovery** — a died worker is detected and respawned to restore capacity (rooms hosted on the dead worker are lost — mediasoup cannot migrate routers; clients reconnect into a fresh room)
* **Router-to-worker binding** — each room's router is pinned to one worker

The developer never creates or manages workers. They call `mediaService.init()` once, then `await mediaService.attachRoom(room)`.

---

## Auth Design

* Auth is built into `@rtcforge/signaling` (core layer) — no separate auth package
* RTCForge validates tokens — it does NOT issue them (issuance is an application-layer concern)
* Developers pass an `auth` async function to `SignalingServer` — use any JWT library
* Token must return: `{ roomId, peerId, role }` — host / participant / viewer
* Validation runs at WebSocket upgrade — rejected tokens never allocate room state
* Throw from the `auth` function to reject a connection

---

## SDK

RTCForge ships a single **JavaScript** SDK (`@rtcforge/sdk`) targeting both Node.js and the browser. No other-language or mobile SDKs are planned — RTCForge is a pure JavaScript/npm library.

---

## Repository Structure

```
rtcforge/                          ← monorepo (npm workspaces)
 ├── packages/                     ← CORE LAYER (published)
 │    ├── core/                    # @rtcforge/core (shared primitives — zero deps)
 │    ├── signaling/               # @rtcforge/signaling (auth hook, Room, Peer)
 │    ├── media/                   # @rtcforge/media (mesh + SFU media plane)
 │    ├── sfu/                     # @rtcforge/sfu (cluster, cascading, fan-out tree, bridges)
 │    ├── sdk/                     # @rtcforge/sdk (browser + Node.js client)
 │    └── adapter-udp/             # @rtcforge/adapter-udp (UdpGossipTransport — gossip wire)
 │
 ├── plan/
 └── docs/
```

---

## Key Lifecycle & Behavior

---

### Room Lifecycle

Rooms are created and destroyed automatically — the developer never calls `createRoom()` or `deleteRoom()`.

```
First peer joins a room ID  →  room auto-created  →  'roomCreated' event fires
Last peer leaves            →  room auto-closed   →  'closed' event fires on room
```

Room state exists only in-memory. If the server restarts, all rooms are gone.
Room persistence is the application layer's responsibility.

---

### Error Events

Every core-layer service emits an `error` event for failures. Always listen to it.

| Service | What triggers `error` |
| ------- | --------------------- |
| `SignalingServer` | WebSocket server failure (per-connection auth failures close the socket, not emitted as server `error`) |
| `MediaService` | mediasoup worker pool error (a worker died and could not be respawned) |
| `SfuCluster` | Node failed its health check (also fires `Overloaded` when all nodes are saturated) |

If you do not listen to `error`, Node.js will throw an unhandled exception and crash your process.

---

### Peer Reconnection

When a client disconnects and reconnects:

* Client reconnects to the same room using the same `peerId` in the JWT token
* `@rtcforge/signaling` detects the reconnect and re-attaches the peer to the existing room
* Media tracks are **not** automatically restored — the client re-publishes after reconnect
* The `peerJoined` event fires again on reconnect (treat it as a fresh join)
* If the room was already closed, the reconnecting peer creates a new room

The client SDK (`@rtcforge/sdk`) handles reconnection automatically with exponential backoff.

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

---

## Extensibility (Injection Points)

RTCForge applies dependency inversion at every seam — replace a default with your own implementation without forking:

* **Logging** — pass `logger` (`Logger`, default no-op) to any service. **Metrics** — pass `metrics` (`MetricsCollector`, default no-op) to `SignalingServer`.
* **Transport** (`@rtcforge/sdk`) — inject `transportFactory` to supply a custom `Transport`; the client depends on the interface, not `WebSocketTransport`.
* **Peer connection** (`@rtcforge/media`) — inject `peerConnectionFactory` on `CallOptions` to mock or swap the mesh WebRTC stack.
* **SFU media plane** (`@rtcforge/media`) — configure `MediaService` with `worker` (pool size / ports / log level), `mediaCodecs` (defaults Opus/VP8/H264), and `webRtcTransport` (listen IPs / bitrates).
* **Node placement** (`@rtcforge/sfu`) — inject `placementStrategy` (`PlacementStrategy`); default is `LeastLoadedStrategy`.
* **Bandwidth estimation** (`@rtcforge/sfu`) — supply any `BandwidthEstimator`; default is `SimpleBandwidthEstimator`.
* **Auth** (`@rtcforge/signaling`) — provide the `auth` async hook.

---

## Key Design Principles

* RTCForge is a **pure WebRTC transport layer** — the core layer is abstract transport; application features are the developer's layer
* The two-layer boundary is event-driven and explicit — core emits, application consumes
* Developers never touch raw WebRTC, SDP, ICE, or mediasoup internals
* The core layer ships no abstract `Chat`/`Whiteboard`/`Recorder` classes — it stops at the transport boundary so the application layer stays unconstrained
* RTCForge has zero internal infrastructure dependencies
* Auth is not optional — validate at the signaling boundary
* Single-instance state is in-memory; horizontal scale is shared-nothing (HashRing + gossip), no central store — operators inject only a socket adapter + host fleet
* JavaScript is the only SDK — RTCForge is a pure JS/npm library, no other-language SDKs planned
* Each package is independent and installable separately
* Prefer event-driven API design throughout
* SOLID throughout — single-purpose collaborators, segregated interfaces, and injectable strategies/factories at every seam
* Focus on developer experience above all else

---

## Final Thought

> RTCForge is not a framework — it is a **WebRTC transport foundation** (the core layer) that teams build their real-time application layer on.

---

## Contributing

Contributions are welcome!
Please read `CONTRIBUTING.md` before submitting PRs.

---

## License

MIT License (or Apache 2.0)
