# sfu-app

SFU (Selective Forwarding Unit) routing demo using `@rtcforge/sdk`, `@rtcforge/signaling`, `@rtcforge/media`, and `@rtcforge/sfu`.

Features: multi-peer video, server-side SFU cluster, cascading router, producer/consumer model, live load reporting — **now wired to the shared-nothing scale stack**: a gossip-discovered fleet (`GossipMembership`), deterministic room→host placement by consistent hash (`HashRingStrategy`), signaling-plane room sharding (`RoomRouter`), and gossip-driven failover (no Redis/etcd).

## Shared-nothing scaling (what's new)

The server now demonstrates how RTCForge scales horizontally with **no central store**:

- **Fleet discovery** — three SFU hosts run a `GossipMembership` (SWIM) and find each other peer-to-peer. One process simulates the fleet over `InMemoryGossipTransport`; production swaps in `UdpGossipTransport` from `@rtcforge/adapter-udp` (one line).
- **Deterministic placement** — `SfuCluster({ membership, placementStrategy: new HashRingStrategy(), nodeFactory })` auto-syncs SFU nodes from gossip and places each room on its owner host via `ring.get(roomId)` — capacity-weighted, zero coordination.
- **Signaling sharding** — a `RoomRouter` over the same fleet computes the owner node for each room. The startup **shard table** prints `room → signaling owner / sfu placement` for sample rooms; the two agree because both hash over the same gossip view.
- **Failover** — at 45s `sfu-us-east-1` stops gossiping; SWIM declares it dead, the ring rebalances, and the shard table reprints to show rooms rerouted.

> This is a single-machine demo, so the live `SignalingServer` runs **without** `cluster` routing (it serves every peer locally) and the `RoomRouter` is used purely to print the shard math. In a real multi-node deploy you pass `cluster: { selfId, membership, onRedirect }` and the server redirects each peer to its room's owner.

## Prerequisites

| Dependency | Version  |
| ---------- | -------- |
| Node.js    | `>= 18`  |
| npm        | `>= 9`   |

Run `npm install` from the **monorepo root** before starting.

> **Browser requirement:** a Chromium or Firefox browser with camera/microphone access.

## How to run

You need two terminals.

**Terminal 1 — signaling server** (WebSocket on port 3006):

```bash
cd examples/sfu-app
npm run server
# SFU app server running on ws://localhost:3006
```

**Terminal 2 — browser dev server** (Vite on port 5178):

```bash
cd examples/sfu-app
npm run dev
# → http://localhost:5178
```

Open **two or more browser tabs** at `http://localhost:5178`.

In each tab:
1. Enter a unique **Peer ID** (e.g. `alice`, `bob`).
2. Enter the same **Room ID** (e.g. `room1`).
3. Click **Join** — allow camera/mic when prompted.

Each peer's video appears in all other tabs. Use **Start/Stop Camera** to toggle the local stream. Watch the server terminal: it prints the gossip-discovered fleet, the deterministic **shard table** (room → owner host), per-room SFU placement, and load changes. After ~45 seconds `sfu-us-east-1` stops gossiping → the ring rebalances and the shard table reprints.

## Scripts

| Script           | Description                                     |
| ---------------- | ----------------------------------------------- |
| `npm run server` | Start the signaling + SFU server (`tsx`)        |
| `npm run dev`    | Start the Vite dev server with hot reload       |
| `npm run build`  | Build the frontend to `dist/`                   |

## Ports

| Service            | Address                    |
| ------------------ | -------------------------- |
| Signaling server   | `ws://localhost:3006`      |
| Browser dev server | `http://localhost:5178`    |

## Architecture

```
                       GossipMembership (SWIM, peer-to-peer) — no Redis/etcd
                       fleet = [sfu-us-east-1, sfu-eu-west-1, sfu-ap-south-1]
                              │ same fleet view everywhere
              ┌───────────────┴────────────────┐
              ▼                                 ▼
Browser tab A ─┐   RoomRouter                SfuCluster + HashRingStrategy
               ├─► ring.get(roomId)=owner    ring.get(roomId)=owner host
Browser tab B ─┘   (signaling shard)         (sfu placement, capacity-weighted)
      │            │                          │
      │            └──► signaling server (server.ts :3006)
      └── RTCPeerConnection                   ├── CascadingRouter (deterministic)
          (direct P2P media)                  └── MediaService → MediaRouter/room
                                                   ├── Producer (per peer)
                                                   └── Consumer (cross-subscriptions)
```

The server runs a `GossipMembership` per SFU host (SWIM, no central store). `SfuCluster` auto-syncs its nodes from gossip and places each room on its owner host via `HashRingStrategy` (consistent hash of `roomId`, capacity-weighted). A `RoomRouter` over the same fleet computes the signaling-plane owner — the two agree by construction. `MediaService` attaches a `MediaRouter` per room. Actual media travels peer-to-peer via `RTCPeerConnection`; the SFU layer demonstrates the `@rtcforge/sfu` placement + scale API. See `docs/SCALING.md` for the full 1M-user model.
