# rtcforge

## 1.1.1

### Patch Changes

- e69014b: Round-4 hardening across all bundled modules plus meta packaging.

  - **core:** reject non-finite/malformed gossip incarnations (closes the `Infinity`-poison vector), revive self on restart, isolate throwing event listeners, prune `_seeds` on tombstone-GC, crypto-random lock tokens, opt-in `StateStore` expiry sweeper.
  - **signaling:** gate signal/broadcast until a peer is admitted, send backpressure (`maxBufferedBytes`), default `maxPeersPerRoom`, surrogate-safe close reasons, `Authorization: Bearer` header fallback, synchronous heartbeat-timeout removal.
  - **sdk client:** token-refresh rejection retries instead of terminating, flush the send queue on reconnect, O(n) throw-resilient `SendQueue` drain, no spurious reconnect on connect-timeout.
  - **filetransfer:** close orphaned reoffer channels, TTL-cap pending channels, auto-apply `sanitizeFileName` (`NodeFileSink.intoDirectory`), guard duplicate-`Sent` double-close, honor pause in the accept→active window, arm a resume re-offer timeout.
  - **media:** bounded polite-side ICE restart before terminal failure, `resumeConsumer` errors on unknown consumer, enforce `CreateTransport.direction`, clear the glare negotiation timer on incoming offers.
  - **sfu:** detach the prior overload listener on `addNode`, log swallowed stats errors, snap the first bandwidth sample.
  - **meta:** per-condition `types` (ESM `.d.mts` / CJS `.d.ts`) on all subpaths, ship `CHANGELOG.md`.

## 1.1.0

### Minor Changes

- 87e4e33: Consolidate into a single self-contained package. `rtcforge` no longer depends on any `rtcforge-*` package — all first-party code is bundled directly into the package.

  Every feature is now reachable from `rtcforge` via its subpaths:

  - `rtcforge/server` — signaling server
  - `rtcforge/client` — browser + Node client
  - `rtcforge/media` — P2P mesh media; resolves to a **mediasoup-free browser build** under a bundler's `browser` condition, and to the full mediasoup SFU server plane in Node
  - `rtcforge/filetransfer` and `rtcforge/filetransfer/node` — P2P file transfer (browser + Node fs sources/sinks)
  - `rtcforge/sfu` and `rtcforge/sfu/udp` — multi-node SFU cluster + gossip transport
  - `rtcforge/core` — shared primitives (`EventEmitter`, `Logger`, `consoleLogger`, `GossipMembership`, `HashRing`, …)

  The `rtcforge-core`, `rtcforge-sdk`, `rtcforge-signaling`, `rtcforge-media`, and `rtcforge-sfu` packages are now private and deprecated on npm — install `rtcforge` instead. `mediasoup` is an optional peer dependency (only needed for the server-side SFU media plane).

## 1.0.1

### Patch Changes

- 7211064: Position `rtcforge` as the single public entry point, and fix a real event bug found on the way.

  - **sdk:** expose peer/broadcast events on `RoomEvent` — `PeerJoined`, `PeerLeft`, `PresenceOnline`, `PresenceOffline`, `Kicked`, `Signal`, `Broadcast`, `RoleChanged`. The documented `room.on(RoomEvent.PeerJoined, …)` API (in the README and BUILDING_APPS guide) previously resolved to `undefined` and never fired.
  - **packaging:** `rtcforge` is now documented as the one package to install. The `rtcforge-*` packages are labeled internal building blocks (npm descriptions + README banners steer users to `rtcforge`). Removed the deprecated `rtcforge-adapter-udp` package (folded into `rtcforge-sfu/udp`).

- Updated dependencies [7211064]
  - rtcforge-sdk@1.0.1
  - rtcforge-signaling@1.0.1
  - rtcforge-media@1.0.1

## 1.0.0

### Minor Changes

- Security + reliability hardening pass across all packages (see REVIEW.md).

  **Security / correctness (P0)**

  - signaling: attach a per-socket `'error'` listener so a single client
    `ECONNRESET`/bad frame no longer crashes the server; state-guard `addPeer` and
    identity-guard room-registry deletion to kill a room-registry corruption race;
    `maxPayloadBytes`, connection/room caps, and per-peer rate limiting now default
    **on** (heartbeat pongs are exempt from rate limiting).
  - sdk: token is redacted from all logged URLs.
  - filetransfer: `awaitDrain` rejects on channel close (no more hang on peer
    disconnect); receiver validates frame `seq`/length and offer `size`/`totalChunks`
    before allocating.
  - media: SFU transport ownership is enforced (`peerId` vs `appData`).
  - sfu/udp (`UdpGossipTransport`): optional HMAC `secret` authenticates datagrams,
    blocking membership poisoning/reflection; warns loudly when unset.

  **Reliability (P1)**

  - media: clear the negotiation timer on answer (no more torn-down healthy calls),
    reap dead routers on worker death (`MediaService` re-emits `WorkerDied`), ICE
    restart before dropping a failed connection (`maxIceRestarts`).
  - sdk: honor non-retryable close codes (default `1008`) with a new `Terminated`
    event; buffer/replay frames across the join→steady-state gap.
  - filetransfer: propagate local failures to the peer; offer-accept timeout.
  - sfu: consecutive-failure threshold + probe timeout for health checks; tear down
    orphaned cascade links on primary failure; `OriginLost` instead of re-rooting a
    dead origin.
  - core: optional `MemoryMembership` TTL sweeper fires watchers on expiry; SWIM
    equal-incarnation dead-override so departures propagate.

  **Packaging / DX**

  - `mediasoup` is now an optional peer dependency, lazily imported — browser-only
    installs no longer compile the native addon.
  - New `rtcforge` meta-package (`rtcforge/client`, `/server`, `/media`,
    `/filetransfer`) for one-install setup.
  - `rtcforge-adapter-udp` is deprecated and folded into `rtcforge-sfu/udp`.
  - `createSignalingServer()` / `createClient()` factories, `consoleLogger`,
    `SfuSignalHandler`, `ReferenceSfuMedia`, `client.room`, `server.port`, exported
    message schemas; `LICENSE`, `engines`, and `sideEffects: false` on every package.

  **Note:** `MediaRouter.connectTransport` now takes `peerId` as its first argument.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - rtcforge-sdk@1.0.0
  - rtcforge-signaling@1.0.0
  - rtcforge-media@1.0.0
