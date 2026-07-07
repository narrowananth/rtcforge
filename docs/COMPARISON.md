# How RTCForge compares

An honest, **feature/architecture** comparison — not a benchmark. Performance depends entirely on your network, media settings, and hardware; for numbers you can trust, run the [benchmark harness](../benchmarks) in *your* environment. This table is about capabilities and where each tool stops.

| Capability | Raw WebRTC | [simple-peer](https://github.com/feross/simple-peer) | [PeerJS](https://peerjs.com/) | [mediasoup](https://mediasoup.org/) | **RTCForge** |
| ---------- | :--------: | :-----: | :----: | :-------: | :----------: |
| Signaling server included | ❌ (you build it) | ❌ | ✅ (broker) | ❌ (SFU only) | ✅ |
| Auth / identity model | ❌ | ❌ | ⚠️ open ids | ❌ | ✅ token → room/peer/role |
| Rooms & presence | ❌ | ❌ | ⚠️ manual | ❌ | ✅ |
| Perfect negotiation / glare handling | ❌ | ⚠️ initiator flag | ⚠️ | n/a | ✅ |
| ICE restart on network change | ❌ | ❌ | ❌ | n/a | ✅ |
| Reconnect + message replay | ❌ | ❌ | ⚠️ | n/a | ✅ |
| P2P mesh (small calls) | ✅ (DIY) | ✅ | ✅ | ❌ | ✅ (`Call`) |
| SFU (group scale) | ❌ | ❌ | ❌ | ✅ | ✅ (wraps mediasoup) |
| Multi-node SFU cluster | ❌ | ❌ | ❌ | ⚠️ DIY orchestration | ✅ (`sfu`, gossip + hash-ring) |
| Cascade fan-out (100k–1M viewers) | ❌ | ❌ | ❌ | ⚠️ DIY | ✅ (`CascadeTree`) |
| No external coordinator (Redis/etcd) | n/a | n/a | n/a | ⚠️ your call | ✅ shared-nothing gossip |
| File transfer (chunked, checksummed) | ❌ | ⚠️ raw `send` | ⚠️ raw | ❌ | ✅ (`filetransfer`) |
| TypeScript types | ⚠️ lib.dom | ⚠️ | ⚠️ | ✅ | ✅ |
| Safe defaults (rate-limit, payload cap) | ❌ | ❌ | ❌ | ❌ | ✅ on by default |

✅ built-in · ⚠️ partial / DIY / caveat · ❌ not provided

## When each is the right pick

- **simple-peer / PeerJS** — a quick 1:1 or tiny P2P demo where you don't need a server, auth, rooms, or scale. Fewer moving parts if that's genuinely all you need.
- **mediasoup (directly)** — you want *only* an SFU and will build signaling, auth, rooms, clustering, and reconnect yourself. RTCForge uses mediasoup under the hood, so you can always drop down.
- **Raw WebRTC** — you need control mediasoup/RTCForge don't expose, and accept owning negotiation, ICE, and signaling.
- **RTCForge** — you want one stack from a 1:1 call to a 1M-viewer cascade cluster, with auth, rooms, reconnect, and safe defaults, adding layers only as real limits force them — no rewrite between stages.

## The differentiator

The other tools each solve one slice (P2P transport, or an SFU, or a broker). RTCForge is the **whole transport plane** with an **additive scale path**: the room/client code is identical from a P2P mesh call to a multi-node cascade cluster; only the media plane changes. See [Building Apps](BUILDING_APPS.md).

> Corrections welcome — if any cell misrepresents another project, open an issue or PR.
