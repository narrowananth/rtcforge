# rtcforge-signaling

> WebSocket signaling server for RTCForge — session lifecycle, rooms, auth, and cluster sharding.

## What

The server-side entry point. `SignalingServer` accepts WebSocket connections, authenticates peers, groups them into `Room`s, and relays the signaling messages (offers, answers, ICE candidates) that WebRTC needs to establish peer connections. `RoomRouter` shards rooms across multiple server nodes.

## Why

Every WebRTC app needs a signaling channel before media can flow — peers must exchange connection info through a server. This package gives you that channel with auth hooks, rate-limiting, and heartbeat built in, so you don't hand-roll a WebSocket protocol.

## Where it fits

```
rtcforge-sdk  ⇄  rtcforge-signaling   (clients connect here to find each other)
                 └─ RoomRouter → shard across nodes
```

Backend layer. Pairs with [`rtcforge-sdk`](https://www.npmjs.com/package/rtcforge-sdk) on the client.

## Architecture

- `SignalingServer` — WebSocket lifecycle, auth, heartbeat, rate-limit.
- `Room` / `Peer` — session grouping and per-connection state.
- `RoomRouter` — consistent-hash room sharding for multi-node clusters.

## How to use

```ts
import { SignalingServer } from "rtcforge-signaling";

const server = new SignalingServer({
  port: 3001,
  auth: async (token) => ({ peerId: verify(token) }), // optional auth hook
  maxPeersPerRoom: 50,
});

await server.start();
```

---

Part of **[RTCForge](https://github.com/your-org/rtcforge)**. See [`docs/PUBLISHING.md`](https://github.com/your-org/rtcforge/blob/master/docs/PUBLISHING.md).
