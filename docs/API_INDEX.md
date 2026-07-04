# RTCForge API Reference

Complete class-level API documentation for every published RTCForge package. Generated from the TypeScript source with [TypeDoc](https://typedoc.org).

RTCForge is a composable set of packages for building real-time communication systems on WebRTC. Install the `rtcforge` meta-package for a one-line setup, or cherry-pick a layer (each pulls `rtcforge-core` transitively).

> **New here? Start with the [Building Apps guide](BUILDING_APPS.md)** — it maps each app type (chat, video call, live stream, whiteboard, file transfer, 1M-viewer scale) to the exact packages and wiring. This API reference is the per-class detail underneath it.

## Quick start

```ts
// client — createClient defaults reconnect on + a warn console logger
import { createClient } from "rtcforge/client";
const room = await createClient({ serverUrl: "wss://your-signaling-host" }).joinRoom("my-room");

// server — createSignalingServer starts with safe defaults on (rate-limit, caps)
import { createSignalingServer } from "rtcforge/server";
const server = await createSignalingServer({ port: 3001, auth });
```

Cherry-picking the underlying packages works too (`import { RTCForgeClient } from "rtcforge-sdk"`, `import { SignalingServer } from "rtcforge-signaling"`).

## Packages

| Package | Install | What it gives you |
| ------- | ------- | ----------------- |
| **rtcforge** | `npm i rtcforge` | One-install front door: `rtcforge/client`, `/server`, `/media`, `/filetransfer` |
| **rtcforge-core** | _(transitive)_ | Shared primitives (`EventEmitter`, `Logger`, `consoleLogger`) + shared-nothing scale primitives (`HashRing`, `GossipMembership`, `StateStore`, …) |
| **rtcforge-signaling** | `npm i rtcforge-signaling` | `SignalingServer`, `createSignalingServer`, `Room`, `Peer`, `RoomRouter` — WebSocket signaling backend |
| **rtcforge-sdk** | `npm i rtcforge-sdk` | `RTCForgeClient`, `createClient`, `Room`, `Transport` — browser + Node client; also `rtcforge-sdk/filetransfer` |
| **rtcforge-media** | `npm i rtcforge-media` (+ `mediasoup` for the SFU) | `Call` (P2P mesh) + `MediaService`/`MediaRouter` + `SfuSignalHandler` (mediasoup SFU) |
| **rtcforge-sfu** | `npm i rtcforge-sfu` | `SfuCluster`, `CascadingRouter`, `CascadeTree`, `ReferenceSfuMedia` — multi-node cascade fan-out; gossip wire at `rtcforge-sfu/udp` |
| **rtcforge-adapter-udp** | _deprecated → `rtcforge-sfu/udp`_ | `UdpGossipTransport` — real network wire for gossip membership |
