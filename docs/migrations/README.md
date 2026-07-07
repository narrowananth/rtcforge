# Migrating to RTCForge

Coming from a hand-rolled WebRTC setup or another library? These guides map your existing concepts onto RTCForge.

| Coming from | Guide | The big shift |
| ----------- | ----- | ------------- |
| Raw `RTCPeerConnection` + your own signaling | [from-raw-webrtc.md](from-raw-webrtc.md) | Stop hand-rolling signaling, perfect-negotiation, ICE-restart, and reconnect. |
| [simple-peer](https://github.com/feross/simple-peer) | [from-simple-peer.md](from-simple-peer.md) | You no longer shuttle `signal` blobs yourself — the server relays them, room-scoped. |
| [PeerJS](https://peerjs.com/) | [from-peerjs.md](from-peerjs.md) | Rooms + auth replace the global peer-id broker; you own the server. |

**Shared mental model:** RTCForge splits into a **signaling server** (`rtcforge/server`) you run, a **client** (`rtcforge/client`) that joins **rooms**, and an optional **media plane** (`rtcforge/media` — P2P `Call` or mediasoup SFU). The libraries above are mostly *client-side P2P*; RTCForge adds the server, auth, rooms, reconnect, and a path to SFU scale without a rewrite.

See also [Building Apps](../BUILDING_APPS.md) and the [feature comparison](../COMPARISON.md).
