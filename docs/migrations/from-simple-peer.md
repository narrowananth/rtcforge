# Migrating from simple-peer

[simple-peer](https://github.com/feross/simple-peer) wraps one `RTCPeerConnection` and hands you raw `signal` blobs that **you** must ferry to the other peer over your own channel. RTCForge gives you that channel (a room-scoped, authenticated signaling server) and drives negotiation for you — so the `signal` shuttling disappears.

## Concept mapping

| simple-peer | RTCForge |
| ----------- | -------- |
| `new SimplePeer({ initiator, stream, trickle })` | `new Call(room, { stream, iceServers })` |
| `peer.on("signal", data => yourChannel.send(data))` | *gone* — the server relays SDP/ICE |
| `peer.signal(dataFromOtherPeer)` | *gone* — handled by `room.bindCall(call)` |
| `peer.on("connect")` | connection state via `Call` events |
| `peer.on("stream", s => …)` | `call.on(MediaEvent.RemoteStream, (peerId, s) => …)` |
| `peer.send(data)` / `peer.on("data", …)` | data channel via `Call`, or `room.broadcast(channel, data)` |
| "who is the other peer?" (you track it) | rooms: `RoomEvent.PeerJoined` / `PeerLeft`, `room.getPeerInfoAll()` |
| `initiator: true/false` you decide | perfect-negotiation — no initiator flag needed |

## Before — simple-peer

```js
import SimplePeer from "simple-peer";

const peer = new SimplePeer({ initiator: location.hash === "#init", stream, trickle: true });

// YOU move every signal blob to the other side over your own transport:
peer.on("signal", (data) => myWebSocket.send(JSON.stringify({ signal: data })));
myWebSocket.onmessage = ({ data }) => peer.signal(JSON.parse(data).signal);

peer.on("stream", (remote) => attachVideo(remote));
peer.on("connect", () => peer.send("hello"));
peer.on("data", (d) => console.log("peer says", d.toString()));
```

## After — RTCForge

You run a signaling server once (see [from-raw-webrtc](from-raw-webrtc.md) for the server), then on the client:

```ts
import { createClient } from "rtcforge/client";
import { Call, MediaEvent, getUserMedia } from "rtcforge/media";

const room = await createClient({ serverUrl: "wss://rtc.myapp.com", token }).joinRoom("r1");
const stream = await getUserMedia({ audio: true, video: true });

const call = new Call(room, { stream, iceServers: room.iceServers });
room.bindCall(call);          // the server relays SDP/ICE — no signal() shuttling
call.start();

call.on(MediaEvent.RemoteStream, (peerId, remote) => attachVideo(peerId, remote));

// data: P2P channel (like peer.send/on('data'))…
const ch = call.createDataChannel(peerId, "chat");
call.on(MediaEvent.DataChannel, (peerId, channel) => channel.onmessage = (e) => console.log(e.data));

// …or via the signaling channel, no data channel needed:
room.broadcast("chat", { text: "hello" });
room.on("broadcast", (from, channel, data) => console.log(from, data));
```

## Key differences

- **No `initiator` flag.** simple-peer makes you pick who offers; `Call` uses perfect negotiation, so both sides run identical code.
- **Multi-peer for free.** simple-peer is one connection; a `Call` in a room connects you to *every* peer (mesh), with `RemoteStream` fired per peer id.
- **You get an auth + rooms boundary.** simple-peer has no notion of identity or grouping — RTCForge's server auth hook and rooms handle both.
- **A scale path.** When mesh runs out (~4 peers), switch to the SFU without touching your room/client code. See [Building Apps](../BUILDING_APPS.md).
