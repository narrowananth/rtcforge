# Building Apps with RTCForge

The one guide to implementing RTCForge in your app. **Pick your app type → get the exact packages, the wiring, and a working example.** For per-class signatures and options, see the **[API reference](https://narrowananth.github.io/rtcforge/)**.

You never install all six packages. Every real app uses 2–4. `rtcforge-core` always arrives transitively — never install it directly.

---

## What RTCForge does (and what you build)

RTCForge is the **transport layer**: it authenticates peers, groups them into rooms, relays messages, and moves audio/video — at scale. **What the bytes mean** (a chat message, a drawing stroke, a video frame) is *your* app. That's why "chat" and "whiteboard" are examples, not packages: they're your code on top of `signaling` + `sdk`.

Every app is the **same three steps**:

1. **Backend** — run a `SignalingServer` (`rtcforge-signaling`): auth, rooms, message relay.
2. **Frontend** — connect with `RTCForgeClient` (`rtcforge-sdk`), join a `Room`.
3. **Media (optional)** — add `rtcforge-media` for audio/video; add `rtcforge-sfu` + `rtcforge-adapter-udp` only when one node isn't enough.

---

## Pick your app type

| I want to build… | Packages | Media |
| ---------------- | -------- | ----- |
| **Chat / presence / notifications** | `signaling` + `sdk` | none |
| **Collaborative** (whiteboard, cursors, live docs) | `signaling` + `sdk` | none (DataChannel) |
| **P2P file transfer** | `sdk` (+ `signaling`) | none (DataChannel) |
| **1:1 & small-group call** (2–4) | `signaling` + `sdk` + `media` | P2P mesh (`Call`) |
| **Group room / webinar** (5–50) | `signaling` + `sdk` + `media` | SFU (`MediaService`) |
| **Live streaming** (1 → many) | `signaling` + `sdk` + `media` | SFU |
| **Massive / multi-region** (1000s, 1M viewers) | + `sfu` + `adapter-udp` | SFU cluster + cascade |

**Media rule of thumb:** 2–4 peers → P2P `Call` (direct, cheapest). 5–50 → SFU `MediaService` (server fans out, flat client bandwidth). 1000s / multi-region → `sfu` cluster.

**Add a layer only when a real limit forces it** — each step is additive, no rewrite: chat/data (`signaling`+`sdk`) → P2P call (`+media Call`) → SFU room (`+media MediaService`) → SFU cluster (`+sfu`+`adapter-udp`) → cascade fan-out for 1M viewers (`sfu CascadeTree`).

---

## Blueprints

Each lists the package set, install, backend + frontend sketch, and the key classes.

### 1. Chat / presence / notifications

`rtcforge-signaling` (server) · `rtcforge-sdk` (client). No media. The signaling channel is a fast, authenticated, room-scoped message bus — chat, typing, presence, and reactions are just messages you relay.

```bash
npm i rtcforge-signaling   # backend
npm i rtcforge-sdk         # frontend
```

**Backend:**

```ts
import { SignalingServer } from "rtcforge-signaling";

const server = new SignalingServer({
  port: 3001,
  auth: async (token) => {
    const user = await myAuth.verify(token);            // your JWT/session check
    return { roomId: user.roomId, peerId: user.id, metadata: { name: user.name } };
  },
  maxPeersPerRoom: 200,
});
await server.start();
```

**Frontend:**

```ts
import { RTCForgeClient, RoomEvent } from "rtcforge-sdk";

const client = new RTCForgeClient({ serverUrl: "wss://rtc.myapp.com", token });
const room = await client.joinRoom("general");

room.on(RoomEvent.PeerJoined, (peer) => showPresence(peer));
room.broadcast("chat", { text: "hello", at: Date.now() });   // fan out to the room
room.on("chat", (msg, from) => renderMessage(from, msg));
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
room.on("stroke", (op) => applyStroke(op));
```

**Key classes:** `RTCForgeClient`, `Room`.

---

### 3. P2P file transfer

`rtcforge-sdk/filetransfer` (+ `signaling` for peer discovery). Files move **directly peer-to-peer** over a DataChannel — chunked, checksummed, resumable — the server never sees the bytes.

```ts
import { FileTransferManager } from "rtcforge-sdk/filetransfer";
// Node receivers: import sinks from "rtcforge-sdk/filetransfer/node"

const ft = new FileTransferManager(/* signaling room / data channel */);
await ft.sendFile(file);                                  // File | Blob in the browser
ft.on("progress", ({ sent, total }) => updateBar(sent / total));
```

**Key classes:** `FileTransferManager`, `SendTransfer`, `ReceiveTransfer`, sinks (`MemorySink`, `StorageSink`, `FileSystemAccessSink`, Node `NodeFileSink`). See the `filetransfer` module in the API reference.

---

### 4. 1:1 & small-group calls (2–4) — P2P mesh

`signaling` + `sdk` + **`rtcforge-media`** (`Call`). Media flows **directly between browsers** (P2P/TURN); the server only relays SDP/ICE. Cheapest and lowest-latency, but each client's uplink grows with peer count — cap around 4.

```bash
npm i rtcforge-media rtcforge-core rtcforge-sdk rtcforge-signaling   # media peer-deps are NOT auto-installed
```

```ts
import { Call, MediaEvent, getUserMedia } from "rtcforge-media";
import { RTCForgeClient } from "rtcforge-sdk";

const client = new RTCForgeClient({ serverUrl: "wss://rtc.myapp.com", token });
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

Add `rtcforge-media` **`MediaService`** (mediasoup SFU). Each client uploads **once**; the server forwards each stream to everyone. Client bandwidth stays flat regardless of room size; server CPU scales across cores via `WorkerPool`.

```ts
import { SignalingServer } from "rtcforge-signaling";
import { MediaService } from "rtcforge-media";

const server = new SignalingServer({ port: 3001, auth });
const media = new MediaService({ /* worker settings, codecs */ });
await server.start();
// per room: media.attachRoom(room) → a MediaRouter answers
// createWebRtcTransport / produce / consume over your signaling messages
```

Frontend: instead of a mesh `Call`, request a transport against the server's `MediaRouter`, then `produce` your tracks and `consume` others'.

**Key classes:** `MediaService`, `MediaRouter`, `WorkerPool`, `Producer`, `Consumer`.

---

### 6. Live streaming (1 → many)

`signaling` + `sdk` + `media` (SFU) with an **asymmetric** room: one **host** produces, many **viewers** only consume. Scales to the node's uplink ceiling on a single SFU.

- Host: `produce(mic, cam)` — or screen via `getDisplayMedia`.
- Viewers: `consume` the host's producers, publish nothing.

**Key classes:** `MediaService` / `MediaRouter` (server), consume-only client.

---

### 7. Massive scale & multi-region (1000s → 1M viewers)

Everything above **+ `rtcforge-sfu` + `rtcforge-adapter-udp`** — many SFU nodes as one **shared-nothing cluster** (no Redis/etcd). Two independent axes:

- **Many rooms across many nodes** — each node holds the same gossip fleet view (`GossipMembership` over `UdpGossipTransport`) and computes the same room owner via `HashRing`. `SfuCluster` + `HashRingStrategy` place each room; `RoomRouter` shards signaling the same way.
- **One stream to 100k–1M viewers** — a single node can't fan out that far. `CascadeTree` builds a tree of relaying SFU nodes (host → relays → edges → viewers); `SimpleBandwidthEstimator` adapts quality; `NodeFailureTracker` drains/fails over.

```ts
import { SfuCluster, HashRingStrategy } from "rtcforge-sfu";
import { UdpGossipTransport } from "rtcforge-adapter-udp";
import { GossipMembership } from "rtcforge-core";

const transport = new UdpGossipTransport({ port: 7946, advertiseHost: "10.0.0.5" });
const membership = new GossipMembership({ id: "sfu-eu-1", address: "10.0.0.5:7946" }, transport);

const cluster = new SfuCluster({ membership, placementStrategy: new HashRingStrategy() });
const owner = cluster.assignNode(undefined, "stream-42");   // which node hosts this room
```

**Key classes:** `SfuCluster`, `CascadingRouter`, `CascadeTree`, `HashRingStrategy`, `SimpleBandwidthEstimator`, `UdpGossipTransport`.

> Note: 1M *interactive* in one room (everyone sending video) is N² fan-out — not achievable by any architecture. Cap active speakers (~25–50 live) and demote the rest to view-only.

---

## Backend setup

You bring auth, a frontend, and (for media) TURN. RTCForge brings the plumbing. Full server options:

```ts
import { SignalingServer } from "rtcforge-signaling";

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
  logger: myLogger, metrics: myMetrics,                            // rtcforge-core contracts
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
- **Reconnect** — built in (`reconnect: true`): backoff + a send queue that replays buffered messages on reconnect. Nothing to wire. Tune `maxReconnectAttempts`, `maxQueueSize`.
- **Observability** — pass `rtcforge-core` `Logger` + `MetricsCollector` into every package; consume `auditLog` for join/leave/kick.
- **Room limits** — `roomIdleTimeoutMs`, `roomMaxDurationMs`, `rateLimit.maxMessagesPerSecond` to blunt floods.
- **Scaling signaling** — `SignalingServer` is per-process. For HA, run a fleet with `cluster: { selfId, membership }`; `RoomRouter` shards rooms by `HashRing` over gossip. Put a **sticky** load balancer in front (a peer's WebSocket stays on one instance), and either redirect via `onRedirect(peerId, roomId, owner)` or route at the edge (`ring.get(roomId)`).
- **Scaling SFU** — `new SfuCluster({ membership, placementStrategy: new HashRingStrategy() })` with a `nodeFactory` that sets each host's real `capacity`. `SfuNode.drain()` for graceful deploys. A dead node stops gossiping → ring rebalances → rooms reroute automatically.
- **Bandwidth** — `SimpleBandwidthEstimator` (high/medium/low + hysteresis) drives simulcast layer selection per subscriber; enable `CallOptions.simulcast`.

---

For every class, method, and option, see the **[API reference](https://narrowananth.github.io/rtcforge/)**.
