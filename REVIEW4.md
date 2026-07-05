# RTCForge — Round-4 Full Re-Review

**Supersedes [`REVIEW3.md`](REVIEW3.md)** (→ [`REVIEW2.md`](REVIEW2.md) → [`REVIEW.md`](REVIEW.md)). Round 1 found 23 bugs. Round 2 verified + found more. Round 3 re-reviewed the new features (resume, async SFU bridges, protocol-version wire-check). This round independently re-reads **every class file in all 6 packages + the `rtcforge` meta**, verifies that **every fix the prior three rounds claimed actually exists in current source**, and hunts fresh.

**Scope:** all 6 packages + `rtcforge` meta (~88 source files across core/signaling/sdk/media/sfu/meta). **Method:** 7 parallel senior reviewers (one per package/module), each given the exact list of prior-round fix-claims to verify against source *plus* a fresh-bug hunt; every finding cites `file:line`.

**Baseline state (verified this round, not taken on faith):**
- `npx vitest run` → **389 tests passed (33 files)** ✅
- `npm run typecheck` → clean ✅
- `npm run build` → all packages build, DTS emitted ✅
- `npx biome check .` → **164 files, 0 issues** ✅

---

## TL;DR — Is everything in the 3 review files solved?

**Yes.** Every fix claimed across REVIEW / REVIEW2 / REVIEW3 was independently re-verified against current source and **all hold** (61 discrete claims checked; see per-package verification below). One claim is *technically* imprecise — signaling's "never splits a surrogate" — but its load-bearing part (the 123-byte close-reason cap) holds; the surrogate edge is cosmetic.

**The bigger news: zero Critical, zero High this round.** Four rounds in, the crash/hang/outage/DoS classes the first three rounds targeted are drained. Every fresh finding is **Med or Low** — pre-existing gaps the earlier rounds simply didn't reach, not regressions in the fixed code.

**One structural fact the prior reviews are now stale on:** the repo **pivoted to a single self-contained bundled package** (`rtcforge`, commit `87e4e33`). The 5 underlying packages are now `private: true` and inlined at build time — so the whole "is 6 npm packages right?" debate is *moot*: **it ships as one published package.** More below.

### Scorecard (Δ vs REVIEW3)

| Package | R3 | R4 (independent) | Why the Δ |
|---|---|---|---|
| `rtcforge-sfu` | 9 | **9** | Holds. Cleanest package; only low/info fresh. |
| `rtcforge` meta | — | **9** | Publish-ready bundle; only dual-`types`-condition nit. |
| `rtcforge-sdk` (filetransfer) | 7.5 | **8.5** | ↑ Was the floor; resume `_gen` fence + terminal cleanup all verified correct. |
| `rtcforge-core` | 9 | **8** | ↓ Not regression — fresh: Gossip trusts wire `incarnation` (Infinity-poison). |
| `rtcforge-sdk` (client) | 8 | **8** | Holds; 2 fresh Med reconnect-edge gaps. |
| `rtcforge-media` | 8 | **8** | All 11 fixes hold; 1 fresh Med (polite-side teardown). |
| `rtcforge-signaling` | 8.5 | **7** | ↓ Not regression — fresh: pre-admission window + no send backpressure. |

**The two downward moves (core, signaling) are not broken fixes** — every prior fix in both still holds. They're stricter independent scores after this round surfaced pre-existing gaps the earlier rounds hadn't hunted (untrusted-wire `incarnation`, send-side backpressure). Honest read: **~8.2 → ~8.1**, flat, with the map of what's left now sharper.

---

## ✅ Was REVIEW3 (and 2, and 1) "fully done"? — Per-package verification

Every claim below was checked against current source with a `file:line`. **All HOLD** unless noted.

### `rtcforge-core` — 8/8 claims hold
- MessageBus isolates a throwing subscriber (snapshot + per-handler try/catch; publish never rejects) — `MessageBus.ts:70-76` ✅
- HashRing rejects NaN/Infinity weight — `HashRing.ts:80` ✅
- Reconciler re-entrancy queue keeps only latest + `start()` guard — `MembershipReconciler.ts:34,54-68` ✅
- Sweeper fires `onRemove` on TTL expiry, unref'd, idempotent stop — `Membership.ts:74-90` ✅
- Gossip equal-incarnation dead-override without breaking refutation — `Gossip.ts:249-268` ✅
- `deregister(remote)` bumps incarnation (not revived by next gossip) — `Gossip.ts:132` ✅
- `register(self)` changed-metadata notifies local watchers — `Gossip.ts:108-120` ✅
- consoleLogger level filter — `types.ts:74-78` ✅

### `rtcforge-signaling` — 12/12 claims hold (1 imprecise)
- `ws.on('error')` attached synchronously before any await — `SignalingServer.ts:206-213` ✅
- addPeer Closing/Closed guard + registry identity-guard — `Room.ts:151-154`, `RoomRegistry.ts:55` ✅
- maxPayload / connection cap / room cap / rate-limit-on-by-default — `SignalingServer.ts:184,223,410`, `:129-131` ✅
- Rate-limit before parse + activity liveness — `Peer.ts:174,181` ✅
- kickPeer synchronous `_peers` removal — `Room.ts:246` ✅
- **⚠️ close-reason 123-byte cap holds, but "never splits a surrogate" is FALSE in an edge case** — `Peer.ts:9-14` `slice(0,-1)` cuts UTF-16 code units and can leave a lone surrogate (encodes to U+FFFD, still ≤123, so harmless — but the claim is inaccurate).
- allowedOrigins CSWSH allowlist — `SignalingServer.ts:216-222` ✅
- Auth error not leaked (generic close reason) — `Authenticator.ts:47-53` ✅
- `start()` re-entrancy guard — `SignalingServer.ts:179` ✅
- PROTOCOL_VERSION on room-joined — `Room.ts:188` ✅
- `dispose()` clears peers/meta — `Room.ts:385-386` ✅
- Failed bind nulls wss/ownServer — `SignalingServer.ts:198-199` ✅

### `rtcforge-sdk` (client) — 8/8 claims hold
- Token redaction on every URL log site (`_safeUrl`) — `WebSocketTransport.ts:77-85,153,217` ✅
- Non-retryable 1008 stops loop, 1006 retries, option exposed — `WebSocketTransport.ts:70,171-195`, `types.ts:48,103` ✅
- Handshake buffer/drain, no double-dispatch, no leak — `JoinHandshake.ts:29-69`, `RTCForgeClient.ts:117-126` ✅
- `Terminated` wired → re-joinable + event — `RTCForgeClient.ts:182-196` (test `:244-265`) ✅
- onTerminated cancels handshake → immediate reject — `RTCForgeClient.ts:186` ✅
- Join catch stale-transport guard — `RTCForgeClient.ts:132-138` ✅
- No mid-dispatch break (listener snapshot) — `core/EventEmitter.ts:98` ✅
- Factory spread order — `factory.ts:21-26` ✅

### `rtcforge-sdk` (filetransfer) — 12/12 claims hold
- `_begin`/`_run` already-Active guard + `_gen` run-generation token — `SendTransfer.ts:301-336,357-387` (test `resume.test.ts:81-115`) ✅
- `_onTerminal` closes `_source` once, on all terminals — `SendTransfer.ts:171` ✅
- Stale pause-gate workers exit via `_gen` fence — `SendTransfer.ts:155-159,308,319,375` ✅
- `_onTerminal` aborts sink, idempotent via `_sinkFinalized` — `ReceiveTransfer.ts:114,318-322,380` ✅
- Checksum enforce (fail if digest required but absent) — `ReceiveTransfer.ts:350-360` (test `:117-142`) ✅
- `resumeSend` guards `interrupted` before opening channels — `FileTransferManager.ts:164-165` ✅
- `awaitDrain` rejects if already-closed + close/error listeners — `channel.ts:50-58,68-85` ✅
- Frame seq/len/offset validated before allocation; offer cross-validated — `ReceiveTransfer.ts:272,283,294,308`, `FileTransferManager.ts:293-320` ✅
- ResumeRequest sends MISSING chunks (inverted-bug fix) — `SendTransfer.ts:232,376` (test `:12-51`) ✅
- Offer timer unref'd/cleared; channels closed; waiters/pending drained — `SendTransfer.ts:152,162-168,201` ✅
- `fail(notifyRemote)` flips state before notify; remote failures don't echo — `Transfer.ts:179,183` ✅
- sanitizeFileName exported — `index.ts:40` ✅

### `rtcforge-media` — 11/11 claims hold
- Neg-timer cleared on ANSWER — `Call.ts:414` ✅
- ICE-restart bounded, can't loop — `Call.ts:490-513` ✅
- Worker-crash router reap chain — `WorkerPool.ts:138-145` → `MediaRouter.ts:63-69` → `MediaService.ts:94-99` ✅
- Transport ownership on connect/produce/consume/resumeConsumer — `MediaRouter.ts:117,127,149,167,297-303` ✅
- mediasoup genuinely lazy (all `import type`; only `import('mediasoup')` in WorkerPool) — `WorkerPool.ts:15,130` ✅
- `restart()` clears `_iceRestarts` + `_remoteStreams` — `Call.ts:300,335-336` ✅
- `_trackEndedCleanups` tracked + detached on remove/replace/close — `Call.ts:101,261,172,321-322` ✅
- replaceTrack unwire-old + wire-new — `Call.ts:172-173` ✅
- close() stops tracks when opted in — `Call.ts:323` ✅
- RemoteStream deduped per stream id — `Call.ts:478-481` ✅
- core + sdk are real `dependencies` — `package.json` ✅

### `rtcforge-sfu` — 9/9 claims hold
- Async bridge surfaces RouteError/PipeError; bookkeeping-before-await — `SfuBridge.ts:38-57,60-85`, `CascadeBridge.ts:44-80` ✅
- Origin failure → OriginLost + detach, no dark re-root — `CascadeTree.ts:252-262` ✅
- Primary failure tears down orphaned cascades — `CascadingRouter.ts:74-80` ✅
- Hung probe can't wedge `_inFlight` (timeout race + finally, unref'd) — `HealthChecker.ts:40,66,76-95` ✅
- Streak thresholds + removeNode clears streaks — `SfuCluster.ts:147-148,199-224` ✅
- ReferenceSfuMedia idempotent bookkeeping — `ReferenceSfuMedia.ts:51-92` ✅
- UDP HMAC `[mac][ts][json]` + length-guard + freshness — `udp.ts:240-243,294-310` ✅
- detach skips redundant removeCascadeRoute for primaried rooms — `SfuBridge.ts:118-124` ✅
- no-secret warning also console.warn on noop logger — `udp.ts:141-148` ✅
- *(Chased the `_lastMsg` timestamp-cache as a possible replay bug — confirmed SAFE: core allocates a fresh gossip msg each round, `Gossip.ts:179`.)*

### `rtcforge` meta — 7/7 claims hold (2 obsolete by design pivot)
- 4 subpath shims resolve to real exporting targets (via build-time bundling) — `src/{client,server,media,filetransfer}.ts` + tsconfig paths + built `dist/*` ✅
- media keeps mediasoup optional; sfu not a hard dep — `package.json:76-90` ✅
- LICENSE MIT in root + all pkgs, in every `files` ✅
- sideEffects:false everywhere ✅
- Changesets configured (`.changeset/`) ✅
- Version consistency (real pkgs `1.0.1`/`^1.0.1`, meta `1.1.0`) ✅
- No `.` root export → bare `import 'rtcforge'` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` (intentional) ✅
- **Obsolete claims** (superseded by the bundle pivot): "meta depends on the real packages" — no, they're `devDependencies`, bundled; and "docs should say `npm i rtcforge rtcforge-media`" — no, `rtcforge-media` is now `private`/unpublished, so current docs (`npm i rtcforge`) are the *correct* form. REVIEW3's line 65/107 recommendation is stale.

---

## ❌ What round-4 found — fresh, all Med/Low (none block ship)

Every item is pre-existing (not a broken prior fix). Ordered by severity.

### MED
| Package | file:line | Defect | Impact |
|---|---|---|---|
| **core** | `Gossip.ts:211-268` | `_merge` trusts wire `entry.incarnation` with no finiteness check. A peer sending `incarnation: Infinity` **permanently freezes** that record — every later finite incarnation fails both `===` and `>`, so a live node can never be updated/revived; for self, `Infinity+1=Infinity` pins self and poisons the cluster's self-view. | One hostile/malformed datagram permanently corrupts membership. Exactly the untrusted-wire boundary the UDP adapter feeds. |
| **signaling** | `SignalingServer.ts:424-458` (+`Peer.ts:87`) | Peer's `message`/`onSignal`/`Broadcast` handlers are wired at construction, but `addPeer` runs only **after** `await iceServersHook`. During that yield an un-admitted (or about-to-be-rejected) peer's frames reach `room.relay`/`broadcastExcept`. | A peer that will be rejected (room-full) can inject broadcasts/signals before admission. Live whenever an async `iceServersHook` is configured. |
| **signaling** | `Peer.ts:146-157` | `send()` never checks `ws.bufferedAmount` — **no send backpressure anywhere**. | A slow/malicious consumer makes the server buffer unboundedly; broadcast fan-out amplifies → memory-exhaustion DoS. |
| **signaling** | `types.ts:317` / `Room.ts:74` | `maxPeersPerRoom` has **no default** → a single room can hold up to `maxConnections` (10k) peers. | Combined with the no-backpressure broadcast path, a severe amplification vector out of the box. |
| **sdk client** | `WebSocketTransport.ts:259-262` | On `tokenRefresh()` rejection during reconnect, it reconnects with the **stale** token → server closes 1008 → non-retryable → `Terminated`. | A transient token-service blip escalates a recoverable reconnect into **permanent** termination. |
| **sdk client** | `WebSocketTransport.ts:150-159` | `onopen` doesn't call `flush()`, contradicting the class's documented "flushed on reconnect." Flush only happens opportunistically via `send()` or the client's room-joined handler. | On session-resume without a re-sent `room-joined`, offline-queued frames strand until the app next sends; `connectionState` can stick at `Reconnecting`. |
| **media** | `Call.ts:493-514` | On `failed`, the **polite** side never waits for the impolite side's ICE restart — it `_dropConnection` + emits `ConnectionFailed` immediately (only `!polite` restarts). | On a mutual transient blip both go `failed`; polite fires a spurious terminal `ConnectionFailed` + full teardown, then rebuilds a brand-new PC when the restart offer arrives. Recovers, but with a false failure event. (test `Call.test.ts:268` confirms polite drops instantly.) |
| **filetransfer** | `SendTransfer.ts:128` | `reoffer` reassigns `this._channels` without closing the previous array; only current `_channels` close in `_onTerminal`. | On a partial drop with `parallelChannels>1`, still-open survivor channels are orphaned → leaked SCTP streams. Full-reconnect case benign. |

### LOW (selected — full list in agent transcripts)
| Package | file:line | Defect |
|---|---|---|
| core | `Gossip.ts:88-106,157-165` | After a `stop()`→`start()` cycle, `self.alive` is never revived → node stays dead-to-itself and reported dead to peers. Restart is advertised (`if(_running)return`) but broken. |
| core | `EventEmitter.ts:98` | `emit` doesn't isolate throwing listeners (unlike the MessageBus fix) — one throw aborts remaining. Inconsistent semantics. |
| core | `Gossip.ts:205-207` | `_merge` reads `entry.{id,incarnation,alive}` with no shape validation — malformed `members` throws / inserts junk. |
| signaling | `types.ts:317`, health endpoint | `attachHealthEndpoint` `request` listener never removed on stop; `getStats().uptime` grows after `stop()`; no-auth mode roomId/peerId unbounded. |
| sdk client | `Room.ts:228-238` | `_refresh` clears `_peerMeta` only when metadata provided → stale peer metadata after a metadata-less roster refresh (slow growth). |
| sdk client | `SendQueue.ts:59-64` | `drain` is O(n²) and a mid-drain `send` throw leaves the erroring item at head + propagates uncaught out of `flush()`. |
| media | `Call.ts:298-305` | Public `restart()` sets `closed=false`, reviving a closed call (no local tracks) — contradicts close()'s "cannot restart" contract. |
| media | `MediaRouter.ts:163-165` / `SfuSignalHandler.ts:87` | `resumeConsumer` returns success for an unknown consumerId → client told media flows when nothing resumed. |
| media | `SfuSignalHandler.ts:49` / `sfuProtocol.ts:32` | `CreateTransport.direction` validated then ignored (always `sendrecv`) — a "recv" transport can `produce`. |
| filetransfer | `FileTransferManager.ts:260-263` | Inbound data channels whose offer never arrives accumulate in `_pendingChannels` unbounded (no TTL/cap) — slow leak / minor DoS. |
| filetransfer | `SendTransfer.ts:402` | A `Pause` in the tiny `Accepted→Active` window is dropped (receiver thinks paused, sender streams on). |
| sfu | `SfuCluster.ts:124-130` | `addNode` overwrites without detaching the prior `overloadListener` — double-`addNode` double-binds / drops tracking. Membership path structurally avoids it. |
| sfu | `StatsCollector.ts:34` | Empty `catch {}` swallows getStats/estimate failures with no log — observability gap. |
| meta | `package.json:16-62` | Single top-level `types` (CJS `.d.ts`) for every subpath while `import` points at `.mjs`; emitted `.d.mts` unreferenced → possible ESM-consumer TS interop errors under `nodenext`. Repo-wide pattern. |

---

## ⚠️ Still-open (confirmed present, documented non-blockers — unchanged tail)

All independently re-confirmed this round:
- **core:** `_seeds` unbounded growth (`Gossip.ts:124,240`, never pruned); StateStore lazy-only expiry (`StateStore.ts:76-84`); MemoryLock predictable sequential tokens (`Lock.ts:83`); one-round false-death flap (inherent to AP/SWIM).
- **signaling:** token-in-query only (`Authenticator.ts:32`); header-auth doc mismatch (code never reads a header); CSWSH close is post-upgrade (no `verifyClient`/`handleUpgrade`); heartbeat-timeout disconnect not synchronous (`HeartbeatMonitor.ts:38`); port/uptime getters report after `stop()`.
- **filetransfer:** per-chunk digest O(chunks) memory; sanitizeFileName not auto-applied; `transferredChunks` can exceed total after resend; duplicate `Sent` while `_tryComplete` awaits can double-close a custom sink; resume whose re-offer is never answered stays Paused (no re-offer timeout).
- **media:** glare **polite-side** neg-timer dangle on mid-call renegotiation (no StateChange to clear it); remove-then-re-add same stream id deduped (no track-level event).
- **sfu:** split-brain / no fencing / no quorum; estimator optimistic zero-sample `high`; `probeTimeoutMs:0` disables the hung-probe guard; UDP replay is freshness-bounding only (no nonce store); >30s fleet clock-skew silently drops gossip.
- **meta:** no `.` root export (intentional subpath-only).

**The one test gap that persists across all 4 rounds:** the **browser/media plane and the end-to-end resume path are still not exercised in a real browser.** The Playwright E2E harness + CI job exist (`e2e/`, `.github/workflows/ci.yml`) but need a real CI run to prove green. This is the single highest-value remaining action — it's the only thing that would catch the media Med findings (polite-side teardown, glare timer) for real.

---

## Architecture note — the "6 packages" question is now moot

REVIEW / REVIEW2 / REVIEW3 all debated whether 6 npm packages was the right shape. **Commit `87e4e33` settled it:** the repo consolidated into a **single self-contained `rtcforge` package**. The 5 underlying packages are `private: true` and **bundled at build** (`tsup`, meta's `devDependencies`); only `ws` + `zod` are runtime deps. Consumers get one install + subpath imports:

```bash
npm i rtcforge              # client + server + P2P media + filetransfer
npm i rtcforge mediasoup    # + SFU media plane (mediasoup is an optional peer)
```

```ts
import { createClient }          from 'rtcforge/client'
import { createSignalingServer } from 'rtcforge/server'
import { Call }                  from 'rtcforge/media'
import { FileTransferManager }   from 'rtcforge/filetransfer'
```

So: **the packaging critique from rounds 1–3 is resolved** — not by the meta-front-door compromise those rounds proposed, but by a full bundle. Only nit remaining: the dual-`types`-condition export map (Low, above).

---

## What we did correctly vs. what we did wrong

### Correctly
- **Every one of the 61 fixes claimed across three prior rounds genuinely exists in current source and holds.** The review→fix→re-review loop worked: the crash (signaling), hang (filetransfer backpressure), dark-broadcast (sfu origin), OOM (filetransfer frame validation), unauthenticated-gossip (UDP HMAC), and token-leak classes are all closed and verified.
- **The newest, riskiest code is correct.** The filetransfer resume `_gen` generation fence — the most complex surface, and the review floor — is verified race-correct against double-send / double-close / stale-worker; it *rose* to 8.5. The async SFU bridges (9/10) surface rejections cleanly.
- **Baseline is real, not mocked-green theater at the unit level:** 389 tests, typecheck, build, and biome all independently re-run clean this round.
- **The packaging pivot is publish-ready** (9/10) — subpaths resolve, tarball is complete, LICENSE/sideEffects/changesets all in place.

### Wrongly (what this round newly exposes)
- **The untrusted-wire boundary in gossip is under-hardened.** `incarnation` (and member shape) is trusted verbatim — `Infinity` permanently poisons membership. The earlier rounds hardened UDP *transport* (HMAC/replay) but not the *payload semantics* behind it.
- **Signaling has no send-side backpressure** and **no default room cap** — the earlier rounds added inbound caps (rate-limit, maxPayload, connection cap) but left the outbound fan-out and per-room ceiling open, which together form an amplification/DoS path.
- **Two reconnect-edge behaviors in the client betray their own contracts:** stale-token reconnect escalates to permanent `Terminated`, and `onopen` doesn't honor the documented flush-on-reconnect.
- **The media glare/polite path still tears down healthy calls** in two scenarios (mutual-failed premature `ConnectionFailed`; mid-call renegotiation timer dangle) — the recurring media weak spot, and precisely what only a real-browser E2E will catch.
- **A handful of contract laxities** (media `restart()` reviving a closed call, `resumeConsumer`/`direction` accepted-but-not-honored) — cosmetic now, foot-guns later.

---

## Bottom line

- **Is everything in the 3 review files solved? Yes** — all 61 prior-round fix-claims verified holding against current source (one claim imprecisely worded, harmless). Nothing from rounds 1–3 regressed.
- **Round 4 net: zero Critical, zero High.** Eight Med findings, all pre-existing gaps outside the previously-fixed code, plus a Low tail. The bug frontier has moved from "crashes and outages" to "hardening and contract-tightening" — the sign of a maturing codebase.
- **Scores ~flat (~8.1).** sfu + meta lead at 9; filetransfer climbed to 8.5; core and signaling dipped to 8/7 on *fresh discovery*, not breakage.
- **Ship recommendation unchanged from R3:** ship behind a beta tag; **run the browser E2E in real CI before cutting `1.0`** — it's still the only thing that validates the media plane (and the media Med findings) for real. Fix the two signaling DoS gaps (backpressure + room-cap default) and the core `incarnation` finiteness check before exposing the UDP gossip plane to any untrusted network.

---

## ADDENDUM — Round-4 fixes applied

**All Round-4 findings above were fixed in this pass** (6 parallel per-package fix agents + meta). Every Med and Low, plus every mechanically-fixable "still-open" item, is now in source with regression tests. Only genuinely structural / by-design items were deliberately deferred (listed at the end).

**Post-fix baseline (re-verified):** typecheck clean · **433 tests pass** (was 389, **+44 regression tests**) · build success · biome clean (168 files). Not yet released.

### Fixed

| Package | Fixes |
|---|---|
| **core** | Gossip untrusted-wire validation (`_isValidEntry`: rejects non-finite/negative/non-integer `incarnation`, bad shape, non-array `members` — kills the `Infinity`-poison vector); `start()` revives self after restart; EventEmitter isolates throwing listeners; `_seeds` pruned on tombstone-GC; MemoryLock uses `crypto.randomUUID()` tokens (no node dep); StateStore opt-in unref'd sweeper. |
| **signaling** | Pre-admission gate (`_admitted` — signal/broadcast ignored until `addPeer` succeeds); send backpressure (`maxBufferedBytes`, default 16 MiB → disconnect on overflow); `maxPeersPerRoom` default 100; surrogate-safe close-reason truncation; health-listener cleanup + `startedAt` reset on `stop()`; no-auth query length bound (256); `Authorization: Bearer` header fallback (doc now true); synchronous heartbeat-timeout removal (`disconnectAndRemove`). |
| **sdk client** | Token-refresh rejection now retries (respects backoff) instead of reconnecting stale → false `Terminated`; `onopen` flushes the send queue (honors documented contract); `_peerMeta` cleared unconditionally on refresh; `SendQueue.drain` O(n) + throw-resilient (re-queues tail, no uncaught escape); connect-timeout can't schedule a spurious reconnect. |
| **sdk filetransfer** | `reoffer` closes orphaned survivor channels; `_pendingChannels` TTL cap (30 s, unref'd); Pause honored in the Accepted→Active window (`_pendingPause`); ControlLink queue cap (1024); `sanitizeFileName` auto-applied via `NodeFileSink.intoDirectory`; dedup sent-chunk counter (progress ≤ total); `_completing` guard against duplicate-`Sent` double-close; reoffer arms an offer-timeout. |
| **media** | Polite side attempts a bounded ICE restart before any terminal `ConnectionFailed` (mutual blip recovers, no spurious teardown); `restart()` guards a closed call; `resumeConsumer` throws on unknown consumerId; `CreateTransport.direction` enforced on produce/consume; `Producer.transportId` honest for piped producers; glare negotiation-timer cleared on incoming offer. |
| **sfu** | `addNode` detaches the prior `overloadListener` before re-binding; `StatsCollector` logs swallowed errors; `parseAddress` handles bracketed IPv6; bandwidth estimator snaps the first sample (no unearned optimistic `high`). |
| **meta** | Per-condition `types` (ESM→`.d.mts`, CJS→`.d.ts`) on all 8 subpaths; `CHANGELOG.md` added to `files`. |

### Deliberately NOT fixed (structural / by-design — need a design change, not a patch)

- **core:** one-round SWIM false-death flap (inherent to AP membership).
- **signaling:** token-in-query as the *primary* mechanism (header fallback added; query still supported); CSWSH close remains post-upgrade (no `verifyClient`).
- **filetransfer:** per-chunk digest O(chunks) memory — intentional space/verification tradeoff enabling order-independent resumable hashing (now documented in `checksum.ts`).
- **media:** remove-then-re-add of the *same* stream id is deduped with no track-level event — needs a track-level protocol change.
- **sfu:** split-brain / no fencing / no quorum; UDP replay is freshness-bounding only (no nonce store); >30 s fleet clock-skew drops gossip; `probeTimeoutMs: 0` disables the hung-probe guard (opt-in footgun).

**Net after fixes:** the Round-4 Med/Low tail is drained. What remains open is the structural list above **plus the unchanged gating item — the browser E2E still needs a real CI run before `1.0`.**
