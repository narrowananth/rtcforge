# RTCForge Roadmap

This is a living document. It reflects current direction, not a commitment to dates. Have an idea? Open a [feature request](https://github.com/narrowananth/rtcforge/issues/new/choose) or a [discussion](https://github.com/narrowananth/rtcforge/discussions).

## Shipped

- ✅ **Signaling** — `SignalingServer`, rooms, auth hook, safe defaults (rate-limit, payload cap, connection/room caps), heartbeat.
- ✅ **Client SDK** — `RTCForgeClient`, `Room`, reconnect with send-queue replay, injectable transport (browser + Node).
- ✅ **P2P media** — `Call`, perfect-negotiation, ICE-restart, `getUserMedia`.
- ✅ **SFU media plane** — `MediaService`, `MediaRouter`, `WorkerPool`, `SfuSignalHandler` (mediasoup).
- ✅ **File transfer** — chunked, checksummed, backpressured P2P transfer over data channels (`FileTransferManager`).
- ✅ **Scale-out** — shared-nothing SFU cluster (`SfuCluster`, `HashRingStrategy`, `GossipMembership`, `UdpGossipTransport`) — no Redis/etcd.
- ✅ **Cascade fan-out** — `CascadeTree` for 100k–1M viewers, bandwidth estimation, node failure tracking.
- ✅ **One-install meta-package** — `rtcforge` with subpath exports.
- ✅ **API reference site** — [narrowananth.github.io/rtcforge](https://narrowananth.github.io/rtcforge/).

- ✅ **Example apps** — five full products (chat, live streaming, collaborative, meet, massive) in [rtcforge_demo_app](https://github.com/narrowananth/rtcforge_demo_app), plus minimal zero-build quick-starts in [`examples/`](examples).
- ✅ **Migration guides** — from [raw WebRTC](docs/migrations/from-raw-webrtc.md), [simple-peer](docs/migrations/from-simple-peer.md), [PeerJS](docs/migrations/from-peerjs.md).
- ✅ **Feature comparison + benchmark harness** — [docs/COMPARISON.md](docs/COMPARISON.md) and a runnable [signaling-throughput bench](benchmarks) (media-plane benches still open).

## In progress

- 🚧 **Documentation site** — guided quick-start beyond the class-level API reference.

## Planned

- 📋 **Recording hooks** — server-side seam for capturing SFU streams.
- 📋 **Simulcast tuning presets** — opinionated layer configs per app type.
- 📋 **Media-plane benchmarks** — SFU forwarding CPU, cascade fan-out (needs browser + mediasoup).
- 📋 **Metrics/telemetry adapters** — Prometheus / OpenTelemetry exporters for `MetricsCollector`.

## Ideas / exploring

- 💡 First-class React hooks package.
- 💡 Managed TURN integration helpers.
- 💡 Edge/serverless signaling deployment recipes.

Legend: ✅ done · 🚧 in progress · 📋 planned · 💡 idea
