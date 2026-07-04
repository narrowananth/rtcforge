---
"rtcforge": minor
---

Consolidate into a single self-contained package. `rtcforge` no longer depends on any `rtcforge-*` package — all first-party code is bundled directly into the package.

Every feature is now reachable from `rtcforge` via its subpaths:

- `rtcforge/server` — signaling server
- `rtcforge/client` — browser + Node client
- `rtcforge/media` — P2P mesh media; resolves to a **mediasoup-free browser build** under a bundler's `browser` condition, and to the full mediasoup SFU server plane in Node
- `rtcforge/filetransfer` and `rtcforge/filetransfer/node` — P2P file transfer (browser + Node fs sources/sinks)
- `rtcforge/sfu` and `rtcforge/sfu/udp` — multi-node SFU cluster + gossip transport
- `rtcforge/core` — shared primitives (`EventEmitter`, `Logger`, `consoleLogger`, `GossipMembership`, `HashRing`, …)

The `rtcforge-core`, `rtcforge-sdk`, `rtcforge-signaling`, `rtcforge-media`, and `rtcforge-sfu` packages are now private and deprecated on npm — install `rtcforge` instead. `mediasoup` is an optional peer dependency (only needed for the server-side SFU media plane).
