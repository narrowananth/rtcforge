# rtcforge-signaling

> WebSocket signaling server for RTCForge — session lifecycle, rooms, auth, and cluster sharding.

📖 **[Full API reference →](https://narrowananth.github.io/rtcforge/modules/rtcforge-signaling.html)**

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
  // The auth hook MUST return roomId, peerId, and role (validated by
  // AuthPayloadSchema) — returning only { peerId } rejects every connection.
  auth: async (token) => {
    const user = await verify(token);
    return { roomId: user.roomId, peerId: user.id, role: user.role ?? "" };
  },
  maxPeersPerRoom: 50,
});

await server.start();
```

Or use the one-call helper, which starts the server with safe defaults on
(rate-limit, payload cap, connection/room caps) and a `warn`-level logger:

```ts
import { createSignalingServer } from "rtcforge-signaling";
const server = await createSignalingServer({ port: 3001, auth });
```

---

Part of **[RTCForge](https://github.com/narrowananth/rtcforge)**. See [`docs/PUBLISHING.md`](https://github.com/narrowananth/rtcforge/blob/master/docs/PUBLISHING.md).
