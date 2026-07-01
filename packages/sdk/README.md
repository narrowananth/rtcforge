# rtcforge-sdk

> Browser + Node.js client for RTCForge — connect, join rooms, exchange signaling.

📖 **[Full API reference →](https://narrowananth.github.io/rtcforge/modules/rtcforge-sdk.html)**

## What

The client your app code talks to. `RTCForgeClient` connects to a [`rtcforge-signaling`](https://www.npmjs.com/package/rtcforge-signaling) server, joins a `Room`, and handles reconnect, a send queue for offline messages, and a pluggable `Transport`.

## Why

A signaling server is useless without a client that speaks its protocol. The SDK hides the WebSocket details — connection state, reconnection with backoff, message queuing — behind a small API, and runs identically in the browser and Node.

## Where it fits

```
your app  →  rtcforge-sdk  ⇄  rtcforge-signaling
                  └─ feed Room into rtcforge-media for audio/video
```

Client layer.

## Architecture

- `RTCForgeClient` — connection + room lifecycle, reconnect strategy, send queue.
- `Room` — peers and signaling events for one session.
- `WebSocketTransport` (default) / `Transport` interface — swap the wire (e.g. for tests).

## How to use

```ts
import { RTCForgeClient } from "rtcforge-sdk";

const client = new RTCForgeClient({
  serverUrl: "wss://your-signaling-host",
  reconnect: true,
});

const room = await client.joinRoom("my-room"); // connects + joins

room.on("peer-joined", (peer) => console.log("joined:", peer.id));
```

For audio/video, pass the `Room` to [`rtcforge-media`](https://www.npmjs.com/package/rtcforge-media).

---

Part of **[RTCForge](https://github.com/narrowananth/rtcforge)**. See [`docs/PUBLISHING.md`](https://github.com/narrowananth/rtcforge/blob/master/docs/PUBLISHING.md).
