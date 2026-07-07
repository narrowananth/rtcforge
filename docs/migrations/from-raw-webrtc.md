# Migrating from raw WebRTC

If you're wiring `RTCPeerConnection` by hand, you're maintaining code RTCForge already owns: the signaling channel, offer/answer negotiation, ICE candidate exchange, glare handling, ICE restart, and reconnect. Here's the mapping.

## What you keep vs. what RTCForge takes over

| You hand-roll today | With RTCForge |
| ------------------- | ------------- |
| A WebSocket/socket.io signaling server | `createSignalingServer({ auth })` — rooms, auth, relay, rate-limit, caps built in |
| Client socket + message routing | `createClient(...).joinRoom(id)` |
| `createOffer` / `createAnswer` / `setLocalDescription` / `setRemoteDescription` | `Call` (perfect negotiation) |
| `onicecandidate` / `addIceCandidate` buffering | `Call` (handled internally) |
| Glare / negotiationneeded races | `Call` (perfect-negotiation pattern) |
| ICE restart on network change | `Call` (built in) |
| Reconnect + message replay | client `reconnect: true` + send queue |
| TURN credential minting | server `iceServersHook` → `room.iceServers` |

## Before — raw WebRTC (abbreviated)

```js
// Your signaling server relays these blobs between two sockets, and you
// hand-code the offer/answer + ICE dance on both ends:
const pc = new RTCPeerConnection({ iceServers });
stream.getTracks().forEach((t) => pc.addTrack(t, stream));
pc.onicecandidate = (e) => e.candidate && ws.send(JSON.stringify({ ice: e.candidate }));
pc.ontrack = (e) => attachVideo(e.streams[0]);
pc.onnegotiationneeded = async () => {
  await pc.setLocalDescription(await pc.createOffer());
  ws.send(JSON.stringify({ sdp: pc.localDescription }));
};
ws.onmessage = async ({ data }) => {
  const m = JSON.parse(data);
  if (m.sdp) {
    await pc.setRemoteDescription(m.sdp);
    if (m.sdp.type === "offer") {
      await pc.setLocalDescription(await pc.createAnswer());
      ws.send(JSON.stringify({ sdp: pc.localDescription }));
    }
  } else if (m.ice) {
    await pc.addIceCandidate(m.ice); // …and buffer if remote desc not set yet
  }
};
// plus: glare handling, ICE restart, reconnect, auth — all your code.
```

## After — RTCForge

**Server** (`rtcforge/server`):

```ts
import { createSignalingServer } from "rtcforge/server";

const server = await createSignalingServer({
  port: 3001,
  auth: async (token) => {
    const user = await myAuth.verify(token); // your existing token check
    return { roomId: user.roomId, peerId: user.id, role: user.role ?? "", metadata: {} };
  },
  iceServersHook: async (peerId) => myTurn.mint(peerId), // per-peer TURN
});
```

**Client** (`rtcforge/client` + `rtcforge/media`):

```ts
import { createClient } from "rtcforge/client";
import { Call, MediaEvent, getUserMedia } from "rtcforge/media";

const room = await createClient({ serverUrl: "wss://rtc.myapp.com", token, reconnect: true }).joinRoom("r1");

const stream = await getUserMedia({ audio: true, video: true });
const call = new Call(room, { stream, iceServers: room.iceServers });
room.bindCall(call);   // wires SDP/ICE relay <-> the peer connection
call.start();

call.on(MediaEvent.RemoteStream, (peerId, remote) => attachVideo(peerId, remote));
```

The offer/answer, ICE exchange, glare, and ICE-restart code all disappear.

## Data channels

Raw `pc.createDataChannel(...)` / `pc.ondatachannel` maps to the `Call` data-channel API (`Call` is a `DataChannelHub`):

```ts
const ch = call.createDataChannel(peerId, "chat");
call.on(MediaEvent.DataChannel, (peerId, channel) => channel.onmessage = (e) => …);
```

Or skip P2P entirely for non-latency-critical data and use the signaling channel: `room.broadcast("chat", data)` / `room.on("broadcast", (from, ch, data) => …)`.

## Scaling past P2P

Raw WebRTC mesh melts past ~4 peers (each client uploads N-1 copies). With RTCForge you swap `Call` for the SFU (`MediaService` + `mediasoup`) — same room/client code — then a multi-node cluster (`rtcforge/sfu`). See [Building Apps](../BUILDING_APPS.md).
