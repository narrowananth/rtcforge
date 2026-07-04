# rtcforge

## 2.0.0

### Major Changes

- 87e4e33: Consolidate into a single self-contained package. `rtcforge` no longer depends on `rtcforge-sdk`, `rtcforge-signaling`, or `rtcforge-media` — all first-party code is now bundled directly into the package. The public import surface is unchanged (`rtcforge/client`, `rtcforge/server`, `rtcforge/media`, `rtcforge/filetransfer`).

  The `rtcforge-core`, `rtcforge-sdk`, `rtcforge-signaling`, `rtcforge-media`, and `rtcforge-sfu` packages are now private and are being deprecated + unpublished from npm. Install `rtcforge` instead.

  `mediasoup` is now an optional peer dependency of `rtcforge` (only needed for server-side `rtcforge/media`).

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
