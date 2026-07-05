---
"rtcforge": patch
---

Round-4 hardening across all bundled modules plus meta packaging.

- **core:** reject non-finite/malformed gossip incarnations (closes the `Infinity`-poison vector), revive self on restart, isolate throwing event listeners, prune `_seeds` on tombstone-GC, crypto-random lock tokens, opt-in `StateStore` expiry sweeper.
- **signaling:** gate signal/broadcast until a peer is admitted, send backpressure (`maxBufferedBytes`), default `maxPeersPerRoom`, surrogate-safe close reasons, `Authorization: Bearer` header fallback, synchronous heartbeat-timeout removal.
- **sdk client:** token-refresh rejection retries instead of terminating, flush the send queue on reconnect, O(n) throw-resilient `SendQueue` drain, no spurious reconnect on connect-timeout.
- **filetransfer:** close orphaned reoffer channels, TTL-cap pending channels, auto-apply `sanitizeFileName` (`NodeFileSink.intoDirectory`), guard duplicate-`Sent` double-close, honor pause in the accept→active window, arm a resume re-offer timeout.
- **media:** bounded polite-side ICE restart before terminal failure, `resumeConsumer` errors on unknown consumer, enforce `CreateTransport.direction`, clear the glare negotiation timer on incoming offers.
- **sfu:** detach the prior overload listener on `addNode`, log swallowed stats errors, snap the first bandwidth sample.
- **meta:** per-condition `types` (ESM `.d.mts` / CJS `.d.ts`) on all subpaths, ship `CHANGELOG.md`.
