# rtcforge-adapter-udp

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
  - rtcforge-sfu@1.0.0
