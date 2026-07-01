# RTCForge API Reference

Complete class-level API documentation for every published RTCForge package. Generated from the TypeScript source with [TypeDoc](https://typedoc.org).

RTCForge is a composable set of packages for building real-time communication systems on WebRTC. Install only the layer you need — everything pulls `rtcforge-core` transitively.

> **New here? Start with the [Building Apps guide](BUILDING_APPS.md)** — it maps each app type (chat, video call, live stream, whiteboard, file transfer, 1M-viewer scale) to the exact packages and wiring. This API reference is the per-class detail underneath it.

## Quick start

```ts
// client
import { RTCForgeClient } from "rtcforge-sdk";
const client = new RTCForgeClient({ serverUrl: "wss://your-signaling-host" });
const room = await client.joinRoom("my-room");

// server
import { SignalingServer } from "rtcforge-signaling";
const server = new SignalingServer({ port: 3001 });
await server.start();
```

## Packages

| Package | Install | What it gives you |
| ------- | ------- | ----------------- |
| **rtcforge-core** | _(transitive)_ | Shared primitives (`EventEmitter`, `Logger`) + shared-nothing scale primitives (`HashRing`, `GossipMembership`, `StateStore`, …) |
| **rtcforge-signaling** | `npm i rtcforge-signaling` | `SignalingServer`, `Room`, `Peer`, `RoomRouter` — WebSocket signaling backend |
| **rtcforge-sdk** | `npm i rtcforge-sdk` | `RTCForgeClient`, `Room`, `Transport` — browser + Node client; also `rtcforge-sdk/filetransfer` |
| **rtcforge-media** | `npm i rtcforge-media` | `Call` (P2P mesh) + `MediaService`/`MediaRouter` (mediasoup SFU) |
| **rtcforge-sfu** | `npm i rtcforge-sfu` | `SfuCluster`, `CascadingRouter`, `CascadeTree` — multi-node cascade fan-out |
| **rtcforge-adapter-udp** | `npm i rtcforge-adapter-udp` | `UdpGossipTransport` — real network wire for gossip membership |
