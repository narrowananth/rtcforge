# Migrating from PeerJS

[PeerJS](https://peerjs.com/) connects peers by a **global peer id** through a broker (PeerServer). RTCForge replaces the id-broker model with **authenticated rooms**: peers join a room, and the server relays within it. You run the server, so identity, access control, and grouping are yours.

## Concept mapping

| PeerJS | RTCForge |
| ------ | -------- |
| PeerServer (`peerjs-server` / cloud broker) | `createSignalingServer({ auth })` — your server |
| `new Peer("my-id")` | `createClient({ serverUrl, token })` (identity comes from the auth hook) |
| `peer.on("open", id => …)` | `await client.joinRoom(roomId)` resolves when connected |
| `peer.connect("other-id")` → `DataConnection` | `room.broadcast(channel, data)` / `room.sendSignal(peerId, data)`, or a `Call` data channel |
| `conn.on("data", …)` / `conn.send(…)` | `room.on("broadcast", (from, ch, data) => …)` / `room.broadcast(...)` |
| `peer.call("other-id", stream)` → `MediaConnection` | `Call` + `room.bindCall(call)` |
| `call.on("stream", s => …)` | `call.on(MediaEvent.RemoteStream, (peerId, s) => …)` |
| Discovering peers | rooms: `RoomEvent.PeerJoined` / `PeerLeft`, `room.getPeerInfoAll()` |
| Global id namespace collisions | scoped: ids are per-room, assigned by *your* auth |

## Before — PeerJS

```js
import { Peer } from "peerjs";

const peer = new Peer(myId); // registers myId with the broker
peer.on("open", (id) => {
  const conn = peer.connect(friendId);        // data
  conn.on("open", () => conn.send("hello"));
  conn.on("data", (d) => console.log(d));

  const call = peer.call(friendId, stream);    // media
  call.on("stream", (remote) => attachVideo(remote));
});
peer.on("connection", (conn) => conn.on("data", (d) => console.log(d)));
peer.on("call", (call) => { call.answer(stream); call.on("stream", attachVideo); });
```

You must already know `friendId` out-of-band, and anyone can claim any id.

## After — RTCForge

**Server** — identity is issued by your auth hook, not chosen client-side:

```ts
import { createSignalingServer } from "rtcforge/server";
const server = await createSignalingServer({
  port: 3001,
  auth: async (token) => {
    const user = await myAuth.verify(token);   // token -> trusted identity
    return { roomId: user.roomId, peerId: user.id, role: user.role ?? "", metadata: { name: user.name } };
  },
});
```

**Client** — join a room; peers discover each other automatically:

```ts
import { createClient, RoomEvent } from "rtcforge/client";
import { Call, MediaEvent, getUserMedia } from "rtcforge/media";

const room = await createClient({ serverUrl: "wss://rtc.myapp.com", token }).joinRoom("r1");

// data — no need to know an id up front; broadcast to the room…
room.broadcast("chat", { text: "hello" });
room.on("broadcast", (from, channel, data) => console.log(from, data));
// …or target one peer directly:
room.on(RoomEvent.PeerJoined, (peerId) => room.sendSignal(peerId, { hi: true }));
room.on(RoomEvent.Signal, (from, data) => console.log("directed", from, data));

// media
const stream = await getUserMedia({ audio: true, video: true });
const call = new Call(room, { stream, iceServers: room.iceServers });
room.bindCall(call);
call.start();
call.on(MediaEvent.RemoteStream, (peerId, remote) => attachVideo(peerId, remote));
```

## Key differences

- **Auth, not open ids.** PeerJS trusts whatever id a client claims; RTCForge's server assigns identity from a verified token — no impersonation, no id squatting.
- **Rooms replace manual id discovery.** You broadcast to a room or react to `PeerJoined`; you don't ferry ids out-of-band.
- **You own the server.** No dependency on a public broker's uptime or rate limits; run it next to your app, with TURN, metrics, and audit hooks.
- **SFU scale path.** PeerJS is mesh-only. Swap `Call` for the SFU when a room outgrows mesh — same client code. See [Building Apps](../BUILDING_APPS.md).
