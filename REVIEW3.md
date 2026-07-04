# RTCForge — Round-3 Re-Review

**Supersedes [`REVIEW2.md`](REVIEW2.md)** (which superseded the original `REVIEW.md`). Round 1 found 23 bugs → fixed. Round 2 verified + found more → fixed. This round re-reviews the code **after** the REVIEW2 hardening AND the newly-added "Later-tier" features (in-session resume, async SFU bridges, protocol-version wiring), verifies they hold, and hunts for regressions the new code introduced.

**Scope:** all 6 packages + `rtcforge` meta. **Method:** 6 parallel senior reviewers, each verifying the specific new code + hunting fresh bugs; every finding checked against source. **State after this round's fixes:** 389 tests green, typecheck clean, all packages build, biome clean.

---

## TL;DR

**The gaps REVIEW2 left are now closed, and the round-3 regressions the new features introduced are fixed too.** Every bug this round surfaced was in code written *this session* (resume state machine, track lifecycle, `Terminated` wiring, shutdown) — the review→fix→re-review loop caught them before they shipped, which is the whole point of running it.

**Overall ~7.7 → ~8.2.** The two lowest packages from REVIEW2 (filetransfer, media) were also the ones I'd just added the most new code to; this round found and fixed the bugs in that new code.

### Scorecard (Δ vs REVIEW2)

| Package | R2 | R3 found-at | After R3 fixes |
|---|---|---|---|
| `rtcforge-core` | 8 | **9** | 9 |
| `rtcforge-sfu` | ~8 | **9** | 9 |
| `rtcforge-signaling` | ~7.5 | 8 | **~8.5** |
| `rtcforge-adapter-udp` + meta | 8 | 8 | **~8.5** |
| `rtcforge-sdk` (client) | ~8 | 7 | **~8** |
| `rtcforge-media` | ~7.5 | 7 | **~8** |
| `rtcforge-sdk` (filetransfer) | ~7.5 | 6 | **~7.5** |

---

## ✅ Verified holding (from earlier rounds + the new features)

Independently confirmed against source + tests this round:

- **Resume happy-path + the inverted-`ResumeRequest` fix**: `haveChunks` semantics correct, worker sends only missing chunks; checksum+resume works (sender re-digests all chunks).
- **Async SFU bridges**: `SfuBridge`/`CascadeBridge` `_run` correctly surfaces async rejections as `RouteError`/`PipeError`; bookkeeping-before-await is the right choice for cleanup. **9/10 — cleanest package.**
- **UDP HMAC + replay**: `[mac][ts][json]` symmetric; length-guard before `timingSafeEqual`; `Date.now()` round-trips losslessly in float64; the serialize-cache stale-ts concern is **safe in practice** (core builds a fresh gossip message every round — verified against the only caller).
- **signaling**: synchronous socket `'error'` truly covers the pre-Peer window; rate-limit-before-parse + any-frame-liveness bounds floods without falsely pruning a busy peer; `kickPeer` sync removal is idempotent vs the later close; `truncateUtf8` never splits a surrogate; CSWSH allowlist, auth-error non-leak, `start()` guard, `PROTOCOL_VERSION` on the wire.
- **sdk client**: `Terminated` → fresh-join works, no mid-dispatch iteration break (EventEmitter snapshots); token redaction on every log site; non-retryable 1008 stops the loop; handshake buffer/drain closes the message-gap.
- **media**: negotiation-timer-cleared-on-answer, ICE-restart-before-drop, router-reap-on-worker-death, transport ownership, lazy mediasoup, `resumeConsumer` ownership — all hold. `rtcforge-core`/`-sdk` are now correct hard deps.
- **core**: `MessageBus` isolates throwing subscribers; `HashRing` rejects NaN/Infinity; `MembershipReconciler` re-entrancy queue keeps only the latest snapshot (correct); sweeper/consoleLogger/gossip-dead-override all hold.
- **meta**: all four subpath shims resolve to real targets; deps correct.

---

## ❌ What round-3 found — **all fixed this round**

Every item was in code added this session. All now fixed + (mostly) regression-tested.

| Sev | Package | Defect | Fix |
|---|---|---|---|
| **HIGH** | filetransfer | `_run` had no already-Active guard → a duplicate `Accept` or spurious `ResumeRequest` spawned a **second concurrent worker set** (double-send). | `_begin` now only (re)starts from Offered or interrupted-Paused; a **run-generation token** (`_gen`) makes every superseded/stale worker exit. |
| **HIGH** | filetransfer | `_onTerminal` never closed `_source` → a Node source **leaked an fd on every completed/failed send**. | `_onTerminal` closes the source on all terminal states (removed the now-duplicate close from `_markCancelled`). |
| MED | filetransfer | Stale workers parked at the pause-gate from an interrupted run resumed on **old channels** alongside the new run (parallelChannels>1). | Same `_gen` fence — released stale workers see the bumped generation and exit. |
| MED | filetransfer | Frame-validation `fail()` paths didn't `sink.abort()` → Node sink leaked its handle + left a partial file. | `_onTerminal` aborts the sink on any non-completed terminal (idempotent via `_sinkFinalized`). |
| MED | filetransfer | Checksum bypass: `offer.checksum=true` but a `Sent` with **no digest** completed unverified. | `_tryComplete` now fails if a digest was required but none arrived. |
| MED | filetransfer | `resumeSend` opened channels **before** the `interrupted` guard → leaked channels if not interrupted. | Guard on `transfer.interrupted` before opening channels. |
| MED | media | `restart()` didn't clear `_iceRestarts`/`_remoteStreams` → a refreshed peer got its ICE-restart budget pre-spent (dropped on first blip) + stale dedupe set. | `_teardownConnections` clears both. |
| MED | media | `_wireTrackEnded` listeners never detached → closed `Call` leaked via the closure + a removed track could fire a **spurious second** `TrackUnpublished`. | Listeners tracked in `_trackEndedCleanups`; detached on remove/replace/close. |
| MED | media | `replaceTrack` didn't rewire `'ended'` → new track's unplug undetected; old track's stale listener could fire. | `replaceTrack` unwires old + wires new. |
| MED | signaling | `dispose()` didn't clear `_peers` → graceful shutdown re-emitted `room-closed`/`peer-left` **after `stop()`** → inflated metrics/audit. | `dispose()` clears `_peers`/`_peerMeta`. |
| MED | sdk client | `onTerminated` didn't cancel a pending handshake → `joinRoom` **hung ~30s** if terminated after socket-open, before `room-joined`. | `onTerminated` cancels the handshake → `joinRoom` rejects immediately. |
| MED | sdk client | The join `catch` mutated shared state without the stale-transport guard → a re-join from within a `Terminated` handler could be clobbered by join#1's late catch. | Guarded all catch mutations with `if (this.transport === transport)`. |
| LOW | signaling | Failed bind (`EADDRINUSE`) left `wss` set → retry `start()` threw "already started" and recovery `stop()` errored. | Null `wss`/`ownServer` in a catch around `listen`. |
| LOW | sfu | `SfuBridge.detach` issued redundant `removeCascadeRoute` after `removeRoute` (which removes all) → spurious `RouteError` on a strict media impl. | Skip cascade teardown for rooms with a primary. |
| LOW | core | `register(self)` with changed metadata didn't `_notify()` local watchers. | Added `_notify()`. |
| MED (docs) | meta | README said `npm i rtcforge mediasoup` for `rtcforge/media`, but `rtcforge-media` is an optional peer npm won't auto-install → import throws. | Corrected to `npm i rtcforge rtcforge-media` across README/PUBLISHING/meta. |

---

## ⚠️ Still-open (documented, not blockers)

Unchanged pre-existing items, none crashes:

- **filetransfer**: per-chunk digest memory O(chunks); `sanitizeFileName` is exported but not auto-applied (apps must call it); progress `transferredChunks` can exceed total after a resend; duplicate `Sent` while `_tryComplete` awaits can double-`close` a custom sink; a resume whose re-offer is never answered stays Paused (no re-offer timeout).
- **media**: glare **polite-side** negotiation-timer dangle (rare: needs `negotiationTimeoutMs` + already-connected + symmetric glare); remove-then-re-add same stream id is deduped (no track-level event).
- **signaling**: token-in-query; header-auth doc mismatch; CSWSH close is post-upgrade not at handshake; heartbeat-timeout disconnect isn't synchronous; `port`/`uptime` getters report after `stop()`.
- **sfu**: split-brain/no fencing; estimator optimistic zero-sample `high`; `probeTimeoutMs:0` disables the hung-probe guard; UDP replay is freshness-bounding (no nonce store); >30s fleet clock-skew silently drops gossip.
- **core**: `_seeds` unbounded growth in a churny cluster; `StateStore` lazy-only expiry; `MemoryLock` predictable tokens; one-round false-death flap window.
- **meta**: no `.` root export → bare `import 'rtcforge'` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` (intentional subpath-only, but a first-try papercut).

**Test gaps** (the recurring theme): unit coverage is now good on fixed paths, but the **end-to-end resume path** (real `_interrupt`→`reoffer`→`resumeSend`) and the **whole media/browser plane** are still not exercised in a real browser. The Playwright E2E harness + CI job exist but need a real CI run to be green.

---

## Was REVIEW2 "fully done"? — **Yes, plus this round's follow-ups.**

- **All of REVIEW2's "Now" + "Next" checklist**: done (MessageBus, HashRing, reconciler, kickPeer-sync, auth-leak, Origin allowlist, start-guard, filetransfer channel/waiter/checksum/sanitize, media track-lifecycle/dedupe/stopTracks, UDP replay). Verified holding this round.
- **REVIEW2's "Later" code items** (resume, async `SfuMediaInterface`, `PROTOCOL_VERSION` wire-check): done — and this round found + fixed the bugs *inside* that new code.
- **The 2 strategic "Later" items remain open by recommendation** (below), not by omission.

So: REVIEW2's gaps are closed. The honest caveat is the same as every round — closing the *known* list ≠ bug-free; each round's new code carried new bugs, which is why the loop is worth running. Round 3's fixes are themselves only unit-verified; a round-4 pass or (better) the browser E2E is what would catch the next layer.

---

## Your 4 points — still all done

| # | Point | Status |
|---|---|---|
| 1 | Fix mediasoup dep | ✅ optional peer + lazy import; browser installs don't compile it. |
| 2 | LICENSE files | ✅ MIT in root + all 7 packages. |
| 3 | sideEffects + CHANGELOG | ✅ `sideEffects:false` everywhere; changesets configured. |
| 4 | Publish CI + browser E2E | ✅ CI + release workflows + Playwright job wired. ⚠️ E2E needs a **real CI run** to prove green (can't execute headless-Chrome here). |

**Still needed?** Yes, all four — done. #4's E2E is the single highest-value remaining action because it's the only thing that tests the media plane (and now the resume path) for real.

## 6 npm — still the right answer

No change from REVIEW2: **it's effectively a 1–2-package install already** via the `rtcforge` meta-package (`npm i rtcforge` + `rtcforge-media` for A/V; `rtcforge-sfu` for scale), with 5 real packages + meta under the hood and `adapter-udp` folded into `rtcforge-sfu/udp`. Round-3 fixed the one remaining wart: the README's wrong `mediasoup` install line.

**Literal 2-package collapse** (`rtcforge` + `rtcforge-server`): still **recommend against** — the meta-package delivers the DX without throwing away per-package cherry-picking or re-churning every import.

---

## Bottom line

- **REVIEW2's gaps: closed.** The new features it asked for (resume, async bridges, version-check) shipped, and this round found + fixed the regressions they introduced.
- **~7.7 → ~8.2.** sfu and core are 9/10; filetransfer remains the floor (7.5) because resume is genuinely the most complex surface and is still only unit-tested.
- **The one thing left that matters**: run the browser E2E in real CI. Everything else open is a documented, non-blocking tail. Ship behind a beta tag; cut `1.0` once E2E is green.
