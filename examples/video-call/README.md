# P2P video call example

1:1 / small-group (2–4) video call over a **P2P mesh**. Media flows directly browser-to-browser; the server only relays SDP/ICE. Uses `rtcforge/server` + `rtcforge/client` + `rtcforge/media` — **no mediasoup**.

## Run

```bash
npm install
node server.mjs        # ws://localhost:3001
```

Open `client.html` in **two tabs or two devices** on the same network. Grant camera + mic. Each side sees the other's video.

> Browsers require a **secure context** for `getUserMedia`. `localhost` counts as secure, so opening the file locally works. Across devices, serve it over HTTPS (or use `localhost` port-forwarding).

## How it works

- **Server** (`server.mjs`) — signaling only. `iceServersHook` hands each peer a STUN server (add TURN for production; ~15% of users need it).
- **Client** (`client.html`):
  - `getUserMedia({ audio, video })` grabs the local stream.
  - `new Call(room, { stream, iceServers: room.iceServers })` + `room.bindCall(call)` + `call.start()` wire the mesh.
  - `call.on(MediaEvent.RemoteStream, (peerId, remote) => …)` attaches each remote video.

Mesh uplink grows with peer count — cap ~4. For 5–50 use the SFU (`MediaService` + `mediasoup`); see [`docs/BUILDING_APPS.md`](../../docs/BUILDING_APPS.md#5-group-rooms--webinars-550--single-node-sfu).
