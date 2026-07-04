# Building Apps with RTCForge

The one guide to implementing RTCForge in your app. **Pick your app type → get the exact packages, the wiring, and a working example.** For per-class signatures and options, see the **[API reference](https://narrowananth.github.io/rtcforge/)**.

You install **one package — `rtcforge`** — and import from its subpaths: `rtcforge/server`, `rtcforge/client`, `rtcforge/media`, `rtcforge/filetransfer` (`/node`), `rtcforge/sfu` (`/udp`), and `rtcforge/core`. Add `mediasoup` only for the server-side SFU media plane (an optional peer dependency). Everything else — signaling, client, P2P media & file transfer, multi-node cluster — is in the box.

> The old `rtcforge-core`, `-sdk`, `-signaling`, `-media`, and `-sfu` packages are **deprecated**; their code now lives inside `rtcforge`. Import the `rtcforge/*` subpaths shown below, not the individual packages.

---

## What RTCForge does (and what you build)

RTCForge is the **transport layer**: it authenticates peers, groups them into rooms, relays messages, and moves audio/video — at scale. **What the bytes mean** (a chat message, a drawing stroke, a video frame) is *your* app. That's why "chat" and "whiteboard" are examples, not packages: they're your code on top of `signaling` + `sdk`.

Every app is the **same three steps**:

1. **Backend** — run a `SignalingServer` (`rtcforge/server`): auth, rooms, message relay.
2. **Frontend** — connect with `RTCForgeClient` (`rtcforge/client`), join a `Room`.
3. **Media (optional)** — add `rtcforge/media` for audio/video (+ `mediasoup` for the SFU); reach for `rtcforge/sfu` (+ `rtcforge/sfu/udp`) only when one node isn't enough.

---

## Pick your app type

| I want to build… | Subpaths | Media |
| ---------------- | -------- | ----- |
| **Chat / presence / notifications** | `server` + `client` | none |
| **Collaborative** (whiteboard, cursors, live docs) | `server` + `client` | none (DataChannel) |
| **P2P file transfer** | `client` + `filetransfer` (+ `server`) | none (DataChannel) |
| **1:1 & small-group call** (2–4) | `server` + `client` + `media` | P2P mesh (`Call`) |
| **Group room / webinar** (5–50) | `server` + `client` + `media` + `mediasoup` | SFU (`MediaService`) |
| **Live streaming** (1 → many) | `server` + `client` + `media` + `mediasoup` | SFU |
| **Massive / multi-region** (1000s, 1M viewers) | + `sfu` + `sfu/udp` | SFU cluster + cascade |

**Media rule of thumb:** 2–4 peers → P2P `Call` (direct, cheapest). 5–50 → SFU `MediaService` (server fans out, flat client bandwidth). 1000s / multi-region → `sfu` cluster.

**Add a layer only when a real limit forces it** — each step is additive, no rewrite: chat/data (`server`+`client`) → P2P call (`+media Call`) → SFU room (`+media MediaService`+`mediasoup`) → SFU cluster (`+sfu`+`sfu/udp`) → cascade fan-out for 1M viewers (`sfu CascadeTree`).

---

## Blueprints

Each lists the package set, install, backend + frontend sketch, and the key classes.

### 1. Chat / presence / notifications

`rtcforge/server` · `rtcforge/client`. No media. The signaling channel is a fast, authenticated, room-scoped message bus — chat, typing, presence, and reactions are just messages you relay.

```bash
npm i rtcforge            # one package: signaling server + client
```

**Backend:** (`createSignalingServer` starts with safe defaults on — rate-limit, payload cap, connection/room caps — and a `warn` logger)

```ts
import { createSignalingServer } from "rtcforge/server";

const server = await createSignalingServer({
  port: 3001,
  // auth MUST return roomId + peerId + role (validated) — returning only peerId rejects everyone.
  auth: async (token) => {
    const user = await myAuth.verify(token);            // your JWT/session check
    return { roomId: user.roomId, peerId: user.id, role: user.role ?? "", metadata: { name: user.name } };
  },
  maxPeersPerRoom: 200,
});
```

**Frontend:** (`peer-joined`/`peer-left` payloads are the peer id string)

```ts
import { createClient, RoomEvent } from "rtcforge/client";

const client = createClient({ serverUrl: "wss://rtc.myapp.com", token });
const room = await client.joinRoom("general");

room.on(RoomEvent.PeerJoined, (peerId) => showPresence(peerId));
room.broadcast("chat", { text: "hello", at: Date.now() });   // fan out to the room
// One "broadcast" event carries (from, channel, data) — filter by channel:
room.on("broadcast", (from, channel, data) => {
  if (channel === "chat") renderMessage(from, data);
});
```

**Key classes:** `SignalingServer`, `Room`, `Peer`, `RTCForgeClient`.

---

### 2. Collaborative apps (whiteboard, cursors, live docs)

Same package set as chat — collaboration is high-frequency structured messages (strokes, cursor positions, CRDT/OT ops).

- **Durable / late-join** (persistence, replay): `room.broadcast(channel, op)` — server fans out; persist server-side if needed.
- **Latency-critical** (live cursors, drawing): open a **P2P DataChannel** so ops skip the server hop.

```ts
const room = await client.joinRoom("board-42");
room.broadcast("stroke", { points, color });
room.on("broadcast", (_from, channel, op) => {
  if (channel === "stroke") applyStroke(op);
});
```

**Key classes:** `RTCForgeClient`, `Room`.

---

### 3. P2P file transfer

`rtcforge/filetransfer` (browser) or `rtcforge/filetransfer/node` (Node `fs` sources & sinks) + `server` for peer discovery. Files move **directly peer-to-peer** over WebRTC data channels — chunked, checksummed, backpressured — the server never sees the bytes.

`FileTransferManager` is transport-agnostic: it takes a **`DataChannelHub`** — a small seam you implement over your `RTCPeerConnection`s. The hub opens an outbound channel for a peer id and surfaces inbound channels via a `data-channel` event:

```ts
interface DataChannelHub {
  createDataChannel(peerId: string, label: string, opts?: RTCDataChannelInit): RTCDataChannel | undefined;
  on(event: "data-channel", handler: (peerId: string, channel: RTCDataChannel) => void): void;
  off(event: "data-channel", handler: (peerId: string, channel: RTCDataChannel) => void): void;
}
```

```ts
import { FileTransferManager, MemorySink, FileTransferEvent } from "rtcforge/filetransfer";

const ft = new FileTransferManager(hub, { checksum: true });

// Send — returns a SendTransfer you can watch / pause / resume / cancel:
const transfer = ft.sendFile(peerId, file /* File | Blob */, { chunkSize: 32 * 1024 });
transfer.on("progress", (p) => updateBar(p.ratio));
transfer.on("complete", () => markDone());

// Receive — an offer surfaces as a not-yet-accepted ReceiveTransfer; accept it
// with a sink to start the byte stream:
ft.on(FileTransferEvent.IncomingOffer, (incoming) => {
  incoming.accept(new MemorySink());          // browser: MemorySink | FileSystemAccessSink
});
```

On Node, import fs-backed sources & sinks from `rtcforge/filetransfer/node` to stream large files without buffering them in memory.

**Key classes:** `FileTransferManager`, `SendTransfer`, `ReceiveTransfer`, `DataChannelHub`, sinks (`MemorySink`, `FileSystemAccessSink`, `StorageSink`; Node fs sinks via `rtcforge/filetransfer/node`), `BlobFileSource`. See the `filetransfer` module in the API reference.

---

### 4. 1:1 & small-group calls (2–4) — P2P mesh

`server` + `client` + **`rtcforge/media`** (`Call`). Media flows **directly between browsers** (P2P/TURN); the server only relays SDP/ICE. Cheapest and lowest-latency, but each client's uplink grows with peer count — cap around 4.

```bash
npm i rtcforge            # gives you rtcforge/client + rtcforge/media
# P2P mesh needs no mediasoup; add `mediasoup` only for the SFU plane (blueprint 5+)
```

```ts
import { Call, MediaEvent, getUserMedia } from "rtcforge/media";   // browser build — no mediasoup
import { createClient } from "rtcforge/client";

const client = createClient({ serverUrl: "wss://rtc.myapp.com", token });
const room = await client.joinRoom("r1");

const stream = await getUserMedia({ audio: true, video: true });
const call = new Call(room, { stream, iceServers: room.iceServers });
room.bindCall(call);                                     // wire signal relay ↔ call
call.start();

call.on(MediaEvent.RemoteStream, (peerId, remote) => attachVideo(peerId, remote));
```

Backend = the same `SignalingServer`, plus per-peer TURN (see [Backend setup](#backend-setup)).

**Key classes:** `Call`, `getUserMedia`, `PeerConnection`, `MediaEvent`.

---

### 5. Group rooms & webinars (5–50) — single-node SFU

Add `rtcforge/media` **`MediaService`** (mediasoup SFU — install `mediasoup` alongside). Each client uploads **once**; the server forwards each stream to everyone. Client bandwidth stays flat regardless of room size; server CPU scales across cores via `WorkerPool`.

```ts
import { createSignalingServer } from "rtcforge/server";
import { MediaService, SfuSignalHandler } from "rtcforge/media";

const server = await createSignalingServer({ port: 3001, auth });
const media = new MediaService({ /* worker settings, codecs */ });
await media.init();
// per room: attach a router and let SfuSignalHandler drive the SFU handshake
const router = await media.attachRoom(room);
const sfu = new SfuSignalHandler(router);   // caps → transport → connect → produce/consume → resume
// on an inbound SFU message from `peerId`: room.send(peerId, await sfu.handle(peerId, msg))
```

`SfuSignalHandler` implements the server side of the SFU control protocol (with transport-ownership enforcement and ingress validation), so you no longer hand-roll it. Frontend: request a transport against the server's `MediaRouter` (via `mediasoup-client`), then `produce` your tracks and `consume` others'.

**Key classes:** `MediaService`, `MediaRouter`, `WorkerPool`, `Producer`, `Consumer`.

---

### 6. Live streaming (1 → many)

`signaling` + `sdk` + `media` (SFU) with an **asymmetric** room: one **host** produces, many **viewers** only consume. Scales to the node's uplink ceiling on a single SFU.

- Host: `produce(mic, cam)` — or screen via `getDisplayMedia`.
- Viewers: `consume` the host's producers, publish nothing.

**Key classes:** `MediaService` / `MediaRouter` (server), consume-only client.

---

### 7. Massive scale & multi-region (1000s → 1M viewers)

Everything above **+ `rtcforge/sfu` + `rtcforge/sfu/udp`** — many SFU nodes as one **shared-nothing cluster** (no Redis/etcd). Two independent axes:

- **Many rooms across many nodes** — each node holds the same gossip fleet view (`GossipMembership` over `UdpGossipTransport`) and computes the same room owner via `HashRing`. `SfuCluster` + `HashRingStrategy` place each room; `RoomRouter` shards signaling the same way.
- **One stream to 100k–1M viewers** — a single node can't fan out that far. `CascadeTree` builds a tree of relaying SFU nodes (host → relays → edges → viewers); `SimpleBandwidthEstimator` adapts quality; `NodeFailureTracker` drains/fails over.

```ts
import { SfuCluster, HashRingStrategy } from "rtcforge/sfu";
import { UdpGossipTransport } from "rtcforge/sfu/udp";
import { GossipMembership } from "rtcforge/core";

const transport = new UdpGossipTransport({
  port: 7946,
  advertiseHost: "10.0.0.5",                                 // real routable host — NOT 127.0.0.1
  secret: process.env.GOSSIP_SECRET,                         // HMAC-authenticate gossip (recommended)
});
await transport.listen();                                    // bind before starting membership

const membership = new GossipMembership({ id: "sfu-eu-1", address: "10.0.0.5:7946" }, transport);
membership.start();

const cluster = new SfuCluster({ membership, placementStrategy: new HashRingStrategy() });
const owner = cluster.assignNode(undefined, "stream-42");   // which node hosts this room
```

**Key classes:** `SfuCluster`, `CascadingRouter`, `CascadeTree`, `HashRingStrategy`, `SimpleBandwidthEstimator`, `UdpGossipTransport`.

> Note: 1M *interactive* in one room (everyone sending video) is N² fan-out — not achievable by any architecture. Cap active speakers (~25–50 live) and demote the rest to view-only.

---

## Backend setup

You bring auth, a frontend, and (for media) TURN. RTCForge brings the plumbing. Full server options:

```ts
import { SignalingServer } from "rtcforge/server";

const server = new SignalingServer({
  port: 3001,
  // REQUIRED — the one integration seam. Your token → who/where the peer is.
  auth: async (token) => {
    const user = await myAuth.verify(token);
    return { roomId: user.roomId, peerId: user.id, role: user.role, metadata: { name: user.name } };
  },
  maxPeersPerRoom: 50,
  rateLimit: { maxMessagesPerSecond: 30 },
  iceServersHook: async (peerId, roomId) => myTurn.mint(peerId),   // per-peer TURN creds
  auditLog: (e) => myLog.write(e),                                 // peer-joined/left/kicked…
  logger: myLogger, metrics: myMetrics,                            // rtcforge/core contracts
});

await server.start();
server.attachHealthEndpoint(httpServer, "/health");                // k8s / load balancer probe
```

**Auth** rejects → connection closed. On the client, set `tokenRefresh` so reconnects don't force re-login:

```ts
const client = new RTCForgeClient({
  serverUrl: "wss://rtc.myapp.com",
  token: await myApp.getToken(),
  tokenRefresh: () => myApp.getToken(),
  reconnect: true,
});
```

---

## Going to production

- **TURN** — production needs it for ~15% of users behind strict NAT. Run coturn; mint per-peer creds in `iceServersHook` → delivered in `room-joined.iceServers`.
- **Reconnect** — built in (`reconnect: true`): backoff + a send queue that replays buffered messages on reconnect. Nothing to wire. Tune `maxReconnectAttempts`, `maxQueueSize`. A non-retryable close (default `1008`, e.g. an expired token) stops the loop and emits `TransportEvent.Terminated` instead of retrying forever.
- **Safe defaults** — `SignalingServer` ships with per-peer rate limiting, a `maxPayloadBytes` cap, and connection/room caps **on by default**; raise or disable them explicitly (`rateLimit.maxMessagesPerSecond: 0` disables). `createSignalingServer` / `createClient` also default a `warn`-level `consoleLogger` so silent drops are visible.
- **Observability** — pass a `Logger` (or `consoleLogger`) + `MetricsCollector` from `rtcforge/core` into the server; consume `auditLog` for join/leave/kick.
- **Room limits** — `roomIdleTimeoutMs`, `roomMaxDurationMs`, `rateLimit.maxMessagesPerSecond` to blunt floods.
- **Scaling signaling** — `SignalingServer` is per-process. For HA, run a fleet with `cluster: { selfId, membership }`; `RoomRouter` shards rooms by `HashRing` over gossip. Put a **sticky** load balancer in front (a peer's WebSocket stays on one instance), and either redirect via `onRedirect(peerId, roomId, owner)` or route at the edge (`ring.get(roomId)`).
- **Scaling SFU** — `new SfuCluster({ membership, placementStrategy: new HashRingStrategy() })` with a `nodeFactory` that sets each host's real `capacity`. Provide `healthCheck.onCheck` and call `startHealthChecks()` — a node is only failed after `failureThreshold` consecutive misses (no flapping). `SfuNode.drain()` for graceful deploys. A dead node stops gossiping → ring rebalances → rooms reroute automatically.
- **Gossip security** — set a shared `secret` on `UdpGossipTransport` (from `rtcforge/sfu/udp`) on any network that isn't fully trusted; without it, datagrams are unauthenticated.
- **Bandwidth** — `SimpleBandwidthEstimator` (high/medium/low + hysteresis) drives simulcast layer selection per subscriber; enable `CallOptions.simulcast`.

---

For every class, method, and option, see the **[API reference](https://narrowananth.github.io/rtcforge/)**.
