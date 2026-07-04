# rtcforge-media

> The media plane for RTCForge — P2P mesh calls and a mediasoup-backed SFU.

📖 **[Full API reference →](https://narrowananth.github.io/rtcforge/modules/rtcforge-media.html)**

## What

Carries the actual audio/video. Two modes:

- **`Call`** — peer-to-peer mesh with perfect-negotiation, for small groups. Drives `RTCPeerConnection`s over an existing signaling `Room`.
- **`MediaService` / `MediaRouter`** — a [mediasoup](https://mediasoup.org) Selective Forwarding Unit (`WorkerPool`, `Producer`, `Consumer`) for larger rooms where mesh doesn't scale.

## Why

Signaling only lets peers find each other; this is where media flows. Mesh is simplest for 2–4 peers; past that, an SFU forwards each sender's stream once per node instead of N times per sender. This package gives you both behind one API.

## Where it fits

```
rtcforge-sdk (Room)  →  rtcforge-media
                          ├─ Call          → P2P mesh (small)
                          └─ MediaService  → SFU (large) → rtcforge-sfu for multi-node
```

## Install

```bash
npm i rtcforge-media            # browser P2P mesh (Call) — no native build
npm i rtcforge-media mediasoup  # add mediasoup for the server-side SFU
```

`mediasoup` is an **optional peer dependency** (a native addon): browser-only
consumers never download or compile it, and it is lazily imported so importing
this package without it only fails when you actually spawn an SFU worker. Import
the browser plane from **`rtcforge-media/browser`** (or the `browser` export
condition) to keep bundlers clear of any Node/mediasoup types.

## How to use

Browser P2P mesh:

```ts
import { Call, MediaEvent } from "rtcforge-media"; // or "rtcforge-media/browser"

// `room` comes from rtcforge-sdk: await client.joinRoom("my-room")
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

const call = new Call(room, { stream });
call.start();

call.on(MediaEvent.RemoteStream, (peerId, remoteStream) => attachToVideoEl(peerId, remoteStream));
```

Server-side SFU — `MediaService` (+ `WorkerPool`) with `SfuSignalHandler` driving
the caps→transport→produce→consume handshake over your signaling:

```ts
import { MediaService, SfuSignalHandler } from "rtcforge-media";

const media = new MediaService();
await media.init();
const router = await media.attachRoom(room);
const sfu = new SfuSignalHandler(router);
// on an inbound SFU message from `peerId`: reply with await sfu.handle(peerId, msg)
```

---

Part of **[RTCForge](https://github.com/narrowananth/rtcforge)**. See [`docs/PUBLISHING.md`](https://github.com/narrowananth/rtcforge/blob/master/docs/PUBLISHING.md).
