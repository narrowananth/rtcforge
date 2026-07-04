# rtcforge-sdk

> ⚠️ **Internal package.** This is a building block of **[`rtcforge`](https://www.npmjs.com/package/rtcforge)**. Unless you need advanced/custom wiring, install **`rtcforge`** and import from `rtcforge/client`, `rtcforge/server`, `rtcforge/media`, or `rtcforge/filetransfer` instead.

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
// createClient defaults reconnect on + a warn console logger; or use `new RTCForgeClient(...)`.
import { createClient } from "rtcforge-sdk";

const client = createClient({ serverUrl: "wss://your-signaling-host" });

const room = await client.joinRoom("my-room"); // connects + joins
// client.room reaches the joined room without holding the return value.

// PeerJoined/PeerLeft payloads are the peer id (a string), not an object:
room.on("peer-joined", (peerId) => console.log("joined:", peerId));

// Exchange application messages over the room. A single "broadcast" event
// carries (from, channel, data) — filter by channel yourself:
room.broadcast("chat", { text: "hello" });
room.on("broadcast", (from, channel, data) => {
  if (channel === "chat") console.log(from, data.text);
});
```

For audio/video, pass the `Room` to [`rtcforge-media`](https://www.npmjs.com/package/rtcforge-media).

---

Part of **[RTCForge](https://github.com/narrowananth/rtcforge)**. See [`docs/PUBLISHING.md`](https://github.com/narrowananth/rtcforge/blob/master/docs/PUBLISHING.md).
