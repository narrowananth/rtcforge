# RTCForge Examples

> **Looking for full, production-shaped apps?** See **[rtcforge_demo_app](https://github.com/narrowananth/rtcforge_demo_app)** — five complete real-time products (chat, live streaming, collaborative whiteboard, meet, massive-scale cascade cluster) with React/Chakra frontends and Node backends, sharing one `rtc-shared` layer. The examples below are minimal by design; that repo is the deep end.

Minimal, copy-pasteable apps built on `rtcforge`. Each folder is self-contained: a Node signaling server + a zero-build browser client (imports `rtcforge` via [esm.sh](https://esm.sh) — no bundler needed).

| Example | What it shows | Media | mediasoup? |
| ------- | ------------- | ----- | ---------- |
| [`chat/`](chat) | Room-scoped messaging + presence over the signaling channel | none | no |
| [`video-call/`](video-call) | 1:1 / small-group P2P mesh call with camera + mic | P2P `Call` | no |
| [`file-transfer/`](file-transfer) | Chunked, checksummed P2P file send over a data channel | none | no |

## Prerequisites

- Node.js `>= 18`
- A modern browser (Chrome/Edge/Firefox/Safari)

## Run any example

```bash
cd examples/<name>
npm install       # installs rtcforge for the server
node server.mjs   # starts the signaling server on :3001
```

Then open `client.html` in two browser tabs (video-call: two devices/tabs; file-transfer: two tabs).

> These examples use a **dev-only auth hook** that trusts the token as the peer id. Real apps must verify tokens — see [`docs/BUILDING_APPS.md`](../docs/BUILDING_APPS.md#backend-setup).

For which packages to use per app type and full wiring, see [`docs/BUILDING_APPS.md`](../docs/BUILDING_APPS.md).
