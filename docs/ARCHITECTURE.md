# RTCForge — Architecture & Integration Guide

RTCForge is a monorepo of composable npm packages for building real-time
communication (WebRTC) systems. Each package owns one layer. You pick the
layers you need — pure P2P needs only `signaling` + `sdk`; large rooms add
`media`; multi-region scale adds `sfu`.

---

## 1. Package map (the whole system)

```
                          ┌────────────────────────────────────────┐
                          │              @rtcforge/core              │
                          │  Logger · MetricsCollector · EventEmitter │
                          │  MediaKind · NetworkStats · toError       │
                          │  HashRing · GossipMembership (SWIM)       │  ← shared-nothing
                          │  Membership · Clock · StateStore          │     scale primitives
                          │  MessageBus · Lock · IdGenerator          │     (interfaces +
                          └──────────────┬───────────────────────────┘      in-mem defaults)
                shared primitives, no runtime deps
        ┌──────────────────┬─────────────┴───────┬──────────────────┐
        ▼                  ▼                      ▼                  ▼
┌────────────────┐ ┌────────────────┐   ┌────────────────┐ ┌────────────────┐
│   signaling    │ │      sdk       │   │     media      │ │      sfu       │
│  (Node server) │ │ (browser/node  │   │ (mediasoup SFU │ │ (multi-node    │
│                │ │   client)      │   │  + P2P Call)   │ │  cluster/mesh) │
│ SignalingServer│ │ RTCForgeClient │   │ MediaService   │ │ SfuCluster     │
│ Room · Peer    │ │ Room · Call    │   │ MediaRouter    │ │ CascadingRouter│
│ Authenticator  │ │ Transport      │   │ Producer/Consume│ │ SfuNode·Bridge │
│ RateLimiter    │ │ ReconnectStrat │   │ WorkerPool     │ │ HealthChecker  │
│ HeartbeatMon.  │ │ SendQueue      │   │ PeerConnection │ │ Placement·Stats│
│ RoomRouter     │ │                │   │                │ │ HashRingStrategy│
│ (cluster)      │ │                │   │                │ │ CascadeTree·Bridge│
└───────┬────────┘ └───────┬────────┘   └───────┬────────┘ └───────┬────────┘
        │   WebSocket (JSON) │                   │                  │
        └────────◄──────────►┘                   │ pipe transports  │
              control plane                      └───── media ──────┘
                                                     plane (RTP)

   ┌──────────────────────────┐
   │   @rtcforge/adapter-udp   │  ← the ONLY socket code: UdpGossipTransport
   │   UdpGossipTransport      │     plugs into core's GossipMembership wire seam
   └──────────────────────────┘
```

**Control plane** = `signaling` ⇄ `sdk` over WebSocket. Carries join, presence,
SDP/ICE relay, broadcast. **Media plane** = audio/video RTP. In P2P it flows
browser-to-browser; with `media` it flows browser ⇄ SFU; with `sfu` it also
flows SFU ⇄ SFU (cascade).

| Package | Runtime | Role | Key deps |
|---|---|---|---|
| `@rtcforge/core` | both | Shared interfaces (Logger, Metrics, EventEmitter) **+ shared-nothing scale primitives** (HashRing, GossipMembership, Membership, Clock, StateStore, MessageBus, Lock, IdGenerator) — interfaces + in-memory/pure defaults, no runtime deps | — |
| `@rtcforge/signaling` | Node | WebSocket signaling server, room/peer lifecycle, auth, rate-limit, heartbeat, **cluster routing (`RoomRouter`)** | `ws`, `zod`, core |
| `@rtcforge/sdk` | browser + Node | Client: connect, join room, relay signals, reconnect, queue | core |
| `@rtcforge/media` | browser (Call) + Node (SFU) | `Call` = P2P WebRTC; `MediaService` = mediasoup SFU | `mediasoup`, core |
| `@rtcforge/sfu` | Node | Cluster of SFU nodes, placement (`HashRingStrategy`), cascade routing, **broadcast fan-out tree (`CascadeTree`/`CascadeBridge`)**, health, bandwidth | core |
| `@rtcforge/adapter-udp` | Node | `UdpGossipTransport` — the real network wire for gossip (the only socket code outside `media`/`signaling`) | core, `dgram` |

---

## 2. Per-package architecture

### 2.1 `@rtcforge/core`

Foundation. No runtime dependencies. Everything else imports these contracts so
packages stay decoupled and you can inject your own logger/metrics.

```
EventEmitter<T>     typed pub/sub base class (all entities extend it)
Logger              debug/info/warn/error/fatal  → noopLogger default
MetricsCollector    increment/gauge/histogram/timing → noopMetrics default
Metric              metric-name constants (rooms_created, peers_connected…)
MediaKind           'audio' | 'video'
NetworkStats        { bitrate, packetLoss, rtt }   used by sfu estimator
toError(unknown)    normalize thrown values to Error

— shared-nothing scale primitives (no Redis/etcd; pure fn + peer-to-peer) —
HashRing            consistent (rendezvous) hashing: get(roomId)→owner, getN,
                    capacity-weighted. The pure routing function.
GossipMembership    SWIM/anti-entropy fleet discovery + failure detection.
  + GossipNetwork   Pure protocol; the wire is injected (GossipTransport iface).
  + GossipTransport  InMemoryGossipTransport default (tests/single-proc);
                     real UDP wire lives in @rtcforge/adapter-udp.
Membership          fleet seam (watch/list) → MemoryMembership single-proc default
MembershipReconciler drives a Membership into onAdd/onRemove/onUpdate callbacks,
                    owning the watch+list bootstrap race once (used by RoomRouter
                    and SfuCluster instead of each re-implementing it)
Clock               injectable time (systemClock / ManualClock) → deterministic
StateStore          durability seam → MemoryStateStore default
MessageBus          cross-node relay seam → LocalMessageBus default
Lock                coordination seam → noopLock / MemoryLock defaults
IdGenerator         randomId / SequentialId
```

No diagram — it is a leaf. Inject `logger`/`metrics` into every other package's
options to get observability across the whole stack. The scale primitives are
**interfaces + in-memory/pure defaults**: a single process uses the defaults and
pays no distributed-systems tax; a distributed deployment injects only a socket
(`@rtcforge/adapter-udp`). See `docs/SCALING.md` for the full model.

---

### 2.2 `@rtcforge/signaling` (server, control plane)

```
                     SignalingServer  (extends EventEmitter)
                     ─ start() / stop() / getStats() / attachHealthEndpoint()
                            │ owns ws.Server
            ┌───────────────┼───────────────────────────┐
   on 'connection'          │                            │
            ▼               ▼                            ▼
      Authenticator    RoomRegistry  ───────────►  RateLimiter (per peer)
      auth(token) →    Map<roomId,Room>            maxMessagesPerSecond
      AuthPayload      create / lookup / GC
      {roomId,peerId,                              HeartbeatMonitor
       role,metadata}                              ping/pong, pongTimeout
            │                                      → disconnect dead peers
            ▼
          Room (extends EventEmitter)
          ─ addPeer · kickPeer · relay · broadcast · setPeerRole · dispose
          ─ state: Creating→Active→Closing→Closed
          ─ maxPeersPerRoom, roomMaxDurationMs, roomIdleTimeoutMs
              │ holds N×
              ▼
            Peer (extends EventEmitter)
            ─ send(ServerMessage) · ping() · disconnect() · setRole()
            ─ wraps one WebSocket
```

**Message flow (wire protocol, `protocol.ts`, validated by zod):**

```
Client ──► Server          Server ──► Client
  signal  {to,data}          room-joined {peers,roles,iceServers}
  broadcast {channel,data}   peer-joined / peer-left
  pong                       presence-online / presence-offline
                             signal {from,data}     ← relayed
                             broadcast {from,...,ts} ← fanned out
                             kicked / role-changed
                             error · ping
```

Server **never touches media** — it only relays opaque `signal` payloads (SDP,
ICE) between peers and fans out `broadcast` to a room. Hooks: `auth`,
`iceServersHook` (per-peer TURN creds), `auditLog`, `metrics`.

**Cluster routing (`RoomRouter`) — horizontal scale-out, shared-nothing.** A
single `SignalingServer` is per-process and holds room state in-memory. To run a
fleet, pass `cluster: { selfId, membership }`. `RoomRouter` watches the gossip
fleet, builds the same `HashRing` on every node, and computes
`ring.get(roomId) → owner`. Each room is owned by **exactly one** node — no shared
store, no broker. If a peer lands on a non-owner node, `onRedirect(peerId, roomId,
owner)` fires so you steer the client to `owner.address` (or route at the edge:
the LB computes `ring.get(roomId)` and lands the peer on the owner directly — no
redirect hop). When a node dies, gossip drops it → the ring rebalances → rooms
reroute. This is the control-plane half of the §SCALING shared-nothing model.

---

### 2.3 `@rtcforge/sdk` (client, control plane)

```
        RTCForgeClient  (extends EventEmitter<ClientEvents>)
        ─ joinRoom(roomId): Promise<Room>   ─ leave()
        ─ events: connected/disconnected/reconnecting/error
                │ owns
                ▼
        Transport (interface) ── default ──► WebSocketTransport
        ─ connect · send · close · flush             │
                │                                     ├── ReconnectStrategy
                │                                     │   exp backoff + jitter
                │                                     ├── SendQueue
                │                                     │   buffer while offline,
                │                                     │   flush on reconnect
                │                                     └── JoinHandshake
                │                                         await room-joined
                ▼
              Room (extends EventEmitter<RoomEvents>)
              ─ sendSignal(to,data) · broadcast(channel,data)
              ─ getPeerInfo / getPeerRole / getPeerMetadata
              ─ bindCall(call)  ◄── bridges to @rtcforge/media Call
              ─ events: peer-joined/left, signal, broadcast, role-changed,
                        presence, closed, refreshed
```

**Connection state machine:**

```
Disconnected ──connect──► Connecting ──open+room-joined──► Connected
     ▲                         │                              │
     │                    error/timeout                  socket drop
     │                         ▼                              ▼
     └──maxAttempts──────  Reconnecting ◄────ReconnectStrategy (backoff)
                              │ on reopen: re-auth (tokenRefresh) →
                              │ re-join → SendQueue.flush()
                              └──────────────────────────────► Connected
```

`bindCall()` is the seam between control and media plane: the Room forwards
incoming `signal` messages into a `Call`, and the Call's outgoing SDP/ICE goes
back out via `room.sendSignal()`.

---

### 2.4 `@rtcforge/media`

Two independent halves sharing types.

**A) Browser P2P — `Call`** (no SFU, mesh between peers):

```
   Room (sdk)  ◄── signal relay ──►  Room (sdk, remote peer)
      │ bindCall
      ▼
    Call (extends EventEmitter<CallEvents>)
    ─ start · addTrack · replaceTrack · addScreenTrack · removeTrack
    ─ muteAudio/Video · createDataChannel · getStats · restart · close
    ─ startActiveSpeakerDetection()
        │ one per remote peer
        ▼
    PeerConnection (perfect-negotiation, polite/impolite)
    ─ handleOffer · handleAnswer · addIceCandidate · addTrack
    ─ restartIce · getStats          wraps RTCPeerConnection
        │ helpers
        ▼
    LocalTrackRegistry · ActiveSpeakerDetector · MediaManager
    (getUserMedia/getDisplayMedia/enumerateDevices/checkPermissions)
```

Perfect-negotiation: `isPolite(local,remote)` decides who backs off on offer
collision. One `PeerConnection` per remote peer → mesh. Good for ≤ ~4 peers.

**B) Server SFU — `MediaService`** (mediasoup, scales rooms):

```
   MediaService (extends EventEmitter)
   ─ init() → boots WorkerPool       ─ attachRoom(room) → MediaRouter
   ─ pipeProducerToRoom() · closeAll()
        │ WorkerPool (spreads mediasoup C++ workers across CPU cores,
        │   least-loaded router assignment)
        │   ─ events: error / worker-died; respawns dead workers on crash
        ▼
   MediaRouter (one per room, extends EventEmitter)
   ─ createWebRtcTransport(peer) → {ice,dtls params}
   ─ connectTransport(dtls) · produce(rtpParams) · consume(producerId)
   ─ resumeConsumer · closeTransportsForPeer
   ─ createPipeTransport / pipeProduce / pipeConsume / pipeProducerTo  ◄─ cascade
        │ holds
        ▼
   Producer (peer's uplink track)   Consumer (downlink to a peer)
   MediaEntity (shared base: id, kind, pause/resume, close)
```

Upload once (Producer), server fans out a Consumer per subscriber. `pipe*`
methods bridge routers/nodes → consumed by `@rtcforge/sfu`.

---

### 2.5 `@rtcforge/sfu` (multi-node scale plane)

Orchestrates many SFU instances. `media` does intra-node; `sfu` does inter-node.

```
   SfuCluster (extends EventEmitter)
   ─ addNode · removeNode · assignNode(region) · rebalance
   ─ startHealthChecks / stopHealthChecks
   ─ membership + nodeFactory → auto-sync SFU fleet from gossip
        │ uses                     │ holds N×
        ▼                          ▼
   PlacementStrategy          SfuNode (extends EventEmitter)
   ─ LeastLoadedStrategy      ─ reportLoad · markFailed/Recovered
   ─ HashRingStrategy         ─ trackRoom · drain(timeout)
     (deterministic room→host,  ─ capacity (weights the ring)
      capacity-weighted)
                              ─ startStatsCollection → StatsCollector
        ▲                       events: load/overloaded/failed/recovered/
        │                               draining/drained/bandwidth-estimate
   HealthChecker                       │
   periodic onCheck(nodeId)            ▼
   → markFailed/Recovered     SimpleBandwidthEstimator
                              estimate(NetworkStats)→high|medium|low
                              hysteresis (up/downgrade streaks)

   CascadingRouter (extends EventEmitter)
   ─ attachRoom(roomId,region) → picks SfuNode via cluster
   ─ getCascadeNodes(roomId) · detachRoom
   ─ events: roomAssigned · cascadeCreated · roomDetached · cascadeDropped
        │ wired to media plane by
        ▼
   SfuBridge(router, SfuMediaInterface)
   ─ attach()/detach(): on roomAssigned→addRoute, cascadeCreated→pipe,
     roomDetached→removeRoute  (SfuMediaInterface = your media adapter)
```

A room lives on a home node. When peers join from another region, the router
**cascades**: a second node joins, `SfuBridge` pipes producers between them via
`media`'s `pipeProducerTo`. `HealthChecker` + `drain()` handle failover.

**Broadcast fan-out (`CascadeTree` + `CascadeBridge`) — 1 broadcaster → N
viewers.** Cascading is pairwise; a 1M-viewer stream needs a *tree*, not a star.
`planCascadeTree` computes a log-depth relay tree (origin → relay tiers → edge
nodes → viewers), sizing tiers by `fanout` and `viewersPerNode`, assigning viewer
slots, and reporting capacity shortfall. `CascadeTree` allocates the plan from the
gossip fleet, emits `LinkCreated`/`LinkDropped` per parent→child edge, and
**rebuilds itself when a node fails** (self-heal). `CascadeBridge` subscribes to
those link events and drives `SfuMediaInterface.pipeLink` → your host calls
`MediaRouter.pipeProducerTo` to move RTP down the tree. Proven by test: 1M
viewers, fanout 8, 1000/edge → ≤ 5 tiers. This is the media-plane half of the
broadcast scaling story; see `docs/SCALING.md §4.2`.

---

## 3. How it works in real life

### Scenario A — P2P video call (2–4 people). Packages: `signaling` + `sdk` + `media` Call

```
 Browser A                 Signaling server            Browser B
 ─────────                 ────────────────            ─────────
 client.joinRoom("r1")  ──ws connect+auth──►  Authenticator.auth(token)
                          ◄─ room-joined {peers:[B], iceServers} ─
 room.bindCall(call)
 call.start()
 PeerConnection offer ── signal{to:B} ──► relay ── signal{from:A} ──► B
                       ◄─ signal{to:A,answer} ─ relay ─ signal{from:B,answer}
 ICE candidates ────────── relayed both ways ──────────────────────►
        │
        └──────────── direct media (RTP, P2P/TURN) ───────────────► B
                    (server NEVER sees audio/video bytes)
```

The signaling server is a dumb, cheap relay. Media is direct → low cost, low
latency, but bandwidth on each client grows with peer count (mesh).

### Scenario B — Group room (10–50). Packages: + `media` MediaService (SFU)

```
 Each Browser                         SFU host (Node)
 ───────────                          ───────────────
 join room ───────────► signaling ─── MediaService.attachRoom → MediaRouter
 createWebRtcTransport request ─────► returns ice/dtls params
 produce(mic,cam) ──────RTP up once──► Producer  (WorkerPool worker)
 consume(others) ◄─────RTP down ×N─── Consumer per remote producer
```

Each client uploads **once**; server fans out. Client bandwidth flat regardless
of room size. Server CPU scales → `WorkerPool` spreads across cores.

### Scenario C — Massive / multi-region. Packages: + `sfu` cluster + `adapter-udp`

```
 signaling fleet (N instances)        SFU fleet (M hosts)
 each runs RoomRouter over gossip      each runs SfuCluster over the SAME gossip
 ring.get(roomId) → owner instance     HashRingStrategy: ring.get(roomId) → owner host
        │ redirect / edge-route               │ producers piped between hosts only
        ▼                                      ▼ when a room spans regions / fans out
 EU users ─► SfuNode(eu)  ◄═══ pipe (cascade / CascadeTree) ═══►  SfuNode(us) ◄─ US users
   GossipMembership (SWIM over UdpGossipTransport) = one fleet view everywhere;
   HealthChecker drains/fails over; BandwidthEstimator adapts layer quality.
```

**Shared-nothing, no Redis/etcd.** Every signaling and SFU node holds the same
gossip fleet view → computes the same owner for any `roomId` via `HashRing` →
routing needs zero coordination and zero central store. Users connect to the
nearest node; `RoomRouter` redirects (or the edge routes) to the room owner;
producers are piped between SFU hosts only when a room spans regions or fans out
to a `CascadeTree`. Failover: a dead node stops gossiping → declared dead →
ring rebalances → `drain()`/`rebalance()` move rooms. See `docs/SCALING.md` for
the 1M-user analysis (it is achievable for many-small-rooms and 1M-viewer
streams; one giant interactive room is precluded by N² physics).

---

## 4. Integrating with an external application

You bring: (1) an auth/token system, (2) a frontend, (3) optionally TURN.
RTCForge brings the signaling + media plumbing.

### 4.1 Backend — stand up signaling

```ts
import { SignalingServer } from '@rtcforge/signaling'

const server = new SignalingServer({
  port: 3001,
  // your app validates the token and returns who/where the peer is
  auth: async (token) => {
    const user = await myAuth.verify(token)        // your JWT/session check
    return { roomId: user.roomId, peerId: user.id, role: user.role,
             metadata: { name: user.name } }
  },
  maxPeersPerRoom: 50,
  rateLimit: { maxMessagesPerSecond: 30 },
  iceServersHook: async (peerId, roomId) => myTurn.mint(peerId), // per-peer TURN
  auditLog: (e) => myLog.write(e),                 // peer-joined/left/kicked…
  logger: myLogger, metrics: myMetrics,            // @rtcforge/core contracts
})
await server.start()
server.attachHealthEndpoint(httpServer, '/health') // for k8s/load balancer
```

**Auth is the integration seam.** The token comes from *your* system; `auth()`
maps it to `{roomId, peerId, role}`. Reject → connection closed.

### 4.2 Frontend — connect, join, call

```ts
import { RTCForgeClient } from '@rtcforge/sdk'
import { Call, getUserMedia } from '@rtcforge/media'

const client = new RTCForgeClient({
  serverUrl: 'wss://rtc.myapp.com',
  token: await myApp.getToken(),
  tokenRefresh: () => myApp.getToken(),  // called on reconnect → no re-login
  reconnect: true,
})

const room = await client.joinRoom('r1')          // resolves on room-joined
const stream = await getUserMedia({ audio: true, video: true })

const call = new Call(room, { stream, iceServers: room.iceServers })
room.bindCall(call)                                // wire signal relay ↔ call
call.start()

call.on('remote-stream', (peerId, stream) => attachVideo(peerId, stream))
room.on('peer-left', (id) => removeVideo(id))
```

For SFU mode you swap the `Call` for transport requests against a server-side
`MediaService` (the server creates `MediaRouter` per room and answers
`createWebRtcTransport` / `produce` / `consume` over your signaling messages).

### 4.3 Full lifecycle (external app ⇄ RTCForge)

```
 1. APP LOGIN          user authenticates in YOUR app → app issues token
 2. CONNECT            client = new RTCForgeClient({token})
                       └► WebSocketTransport.connect() → ws handshake
                          server: Authenticator.auth(token) → AuthPayload
 3. JOIN               client.joinRoom(id)
                       server: RoomRegistry get/create Room → Room.addPeer
                       ◄ room-joined {peers, roles, iceServers}
                       broadcast peer-joined to others
 4. NEGOTIATE MEDIA    room.bindCall(call); call.start()
                       SDP offer/answer + ICE relayed as `signal` messages
                       (P2P) OR produce/consume against SFU MediaRouter
 5. ACTIVE             media flows; broadcast() for chat/data;
                       HeartbeatMonitor ping/pong keeps liveness;
                       RateLimiter guards flood; setPeerRole for promote
 6. INTERRUPT          socket drop → ConnectionState.Reconnecting
                       ReconnectStrategy backoff → tokenRefresh() → re-join
                       SendQueue.flush() replays buffered messages
 7. LEAVE              client.leave() → ws close
                       server: Room removes Peer → broadcast peer-left
                       room idle/duration timers → Room.dispose() when empty
 8. SHUTDOWN           server.stop() → drain peers, close rooms
                       (cluster: SfuNode.drain() → rebalance → remove)
```

### 4.4 Integration checklist

- **Auth**: implement `auth(token)` against your identity system — the only
  required hook. Use `tokenRefresh` on the client so reconnects don't force
  re-login.
- **TURN**: production needs TURN for ~15% of users behind strict NAT. Supply
  via `iceServersHook` (server) → arrives in `room-joined.iceServers`.
- **Topology**: 2–4 peers → P2P `Call`. 5–50 → add SFU `MediaService`.
  Multi-region/1000s → add `sfu` cluster.
- **Observability**: pass `@rtcforge/core` `Logger` + `MetricsCollector` into
  every package; consume `auditLog` for join/leave/kick events.
- **Scaling signaling**: `SignalingServer` is per-process. For HA, run a fleet
  with `cluster: { selfId, membership }` — `RoomRouter` shards rooms across nodes
  by `HashRing` over the gossip fleet (shared-nothing, no Redis). Put a sticky LB
  in front (a peer's WS stays on one instance) and either redirect via
  `onRedirect` or route at the edge with `ring.get(roomId)`. Inject a
  `GossipTransport` (`@rtcforge/adapter-udp`'s `UdpGossipTransport`) for the wire.
- **Data/chat**: use `room.broadcast(channel, data)` (server fan-out) or
  `call.createDataChannel()` (P2P direct) — no separate chat package needed.
```
