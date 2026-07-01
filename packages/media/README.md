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

Peer dependencies are **not** auto-installed — add them explicitly:

```bash
npm install rtcforge-media rtcforge-core rtcforge-sdk rtcforge-signaling
```

## How to use

```ts
import { Call, MediaEvent } from "rtcforge-media";

// `room` comes from rtcforge-sdk: await client.joinRoom("my-room")
const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

const call = new Call(room, { stream });
call.start();

call.on(MediaEvent.RemoteStream, (peerId, remoteStream) => attachToVideoEl(peerId, remoteStream));
```

For server-side SFU, use `MediaService` with a `WorkerPool`.

---

Part of **[RTCForge](https://github.com/narrowananth/rtcforge)**. See [`docs/PUBLISHING.md`](https://github.com/narrowananth/rtcforge/blob/master/docs/PUBLISHING.md).
