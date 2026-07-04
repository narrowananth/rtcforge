# RTCForge API Reference

Complete class-level API documentation for RTCForge, generated from the TypeScript source with [TypeDoc](https://typedoc.org).

RTCForge ships as a **single package — `rtcforge`** — that bundles the signaling server, the browser/Node client, the media plane (P2P mesh + mediasoup SFU), file transfer, and the multi-node cluster tools. You import each layer from a subpath.

> **New here? Start with the [Building Apps guide](BUILDING_APPS.md)** — it maps each app type (chat, video call, live stream, whiteboard, file transfer, 1M-viewer scale) to the exact subpaths and wiring. This API reference is the per-class detail underneath it.

## Quick start

```ts
// client — createClient defaults reconnect on + a warn console logger
import { createClient } from "rtcforge/client";
const room = await createClient({ serverUrl: "wss://your-signaling-host" }).joinRoom("my-room");

// server — createSignalingServer starts with safe defaults on (rate-limit, caps)
import { createSignalingServer } from "rtcforge/server";
const server = await createSignalingServer({ port: 3001, auth });
```

## Entry points

Everything is `npm i rtcforge` (add `mediasoup` only for the server-side SFU). The old `rtcforge-core`/`-sdk`/`-signaling`/`-media`/`-sfu` packages are **deprecated** — use the subpaths below.

| Subpath | Runtime | What it gives you |
| ------- | ------- | ----------------- |
| **`rtcforge/server`** | Node | `SignalingServer`, `createSignalingServer`, `Room`, `Peer`, `RoomRouter` — WebSocket signaling backend |
| **`rtcforge/client`** | Browser + Node | `RTCForgeClient`, `createClient`, `Room`, `Transport`, `ClientEvent`, `RoomEvent` |
| **`rtcforge/media`** | Browser + Node | `Call` + `getUserMedia` (browser P2P mesh) · `MediaService`/`MediaRouter`/`SfuSignalHandler` (mediasoup SFU, Node). Resolves to a mediasoup-free build under a bundler's `browser` condition. |
| **`rtcforge/filetransfer`** | Browser | `FileTransferManager`, `MemorySink`, `FileSystemAccessSink`, `DataChannelHub` |
| **`rtcforge/filetransfer/node`** | Node | `fs`-backed file sources & sinks |
| **`rtcforge/sfu`** | Node | `SfuCluster`, `CascadingRouter`, `CascadeTree`, `HashRingStrategy`, `ReferenceSfuMedia` — multi-node cascade fan-out |
| **`rtcforge/sfu/udp`** | Node | `UdpGossipTransport` — real network wire for gossip membership |
| **`rtcforge/core`** | Any | Shared primitives (`EventEmitter`, `Logger`, `consoleLogger`, `MetricsCollector`) + scale primitives (`HashRing`, `GossipMembership`, `Membership`, `StateStore`, …) |
