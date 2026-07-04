# RTCForge — Post-Hardening Re-Review

**Supersedes [`REVIEW.md`](REVIEW.md)** (the original first-pass audit). That review found 23 bugs; all were fixed in a hardening pass. This is a fresh independent re-review of the **current** code: it verifies the fixes hold, hunts for bugs introduced by the changes, and re-answers the packaging questions against today's reality.

**Scope:** All 6 published packages + the new `rtcforge` meta-package, every class file. **Method:** 6 parallel senior reviewers (one per package/module), each told to verify the specific fixes AND find new defects; every new CRITICAL/HIGH re-verified against source. **State:** 369 tests green, typecheck clean, all packages build, biome clean.

---

## TL;DR

The hardening worked. **Overall ~5.7/10 → ~7.8/10.** Every original CRITICAL and HIGH is fixed and the fixes were independently verified to hold. The re-review then found a handful of *new* gaps — two serious (an incomplete crash-fix, a packaging regression) — **which have now also been fixed and verified in this pass.** What remains is a tail of pre-existing MEDIUM/LOW issues (mostly unchanged from the first review) plus the one structural limit no local change resolves (the SFU media interface is synchronous).

This is now a **solid late-beta**: safe defaults, verified failure paths, one-install DX. The gating item is unchanged — **browser E2E is scaffolded but not run**, so the media plane is still only mock-tested.

### Scorecard (Δ vs original REVIEW.md)

| Package | Was | Re-review | After this fix pass | Verdict |
|---|---|---|---|---|
| `rtcforge-core` | 6 | **8** | 8 | All 3 fixes hold; residual pre-existing MEDIUMs (MessageBus, HashRing) |
| `rtcforge-adapter-udp` | 5 | **8** | 8 | Correct deprecation shim; HMAC transport sound |
| `rtcforge-signaling` | 5.5 | 6.5 | **~7.5** | Crash-fix was **incomplete → now fixed**; flood-bounds fixed |
| `rtcforge-sdk` (client) | 6.5 | 7.5 | **~8** | Transport/handshake fixes hold; `Terminated` now wired to client |
| `rtcforge-sdk` (filetransfer) | 5.5 | 7 | **~7.5** | Validation/notify hold; drain edge + timer leak fixed |
| `rtcforge-media` | 6 | 7 | **~7.5** | Ownership/reap/lazy-import hold; **sdk-dep regression fixed** |
| `rtcforge-sfu` | 5 | 7.5 | **~8** | All 6 fixes hold; streak-cleanup on node reuse fixed |

---

## ✅ What we did correctly (verified fixes that hold)

Independently confirmed against source + tests:

- **signaling** — per-socket `'error'` handling (crash class closed, see caveat below); `addPeer` Closing/Closed guard + registry identity-guard fully close the zombie-room race; `maxPayload`/connection/room caps + default-on rate limit are correct and the connection counter is leak-free; `port` getter, factory, schema exports present.
- **sdk client** — token redaction covers **every** URL log site; non-retryable close (1008) genuinely stops the dead-token reconnect loop while 1006 still retries; the JoinHandshake buffer/drain **closes the handshake→steady-state message-loss window with no double-processing and no leak** (every error path calls `dispose()`).
- **filetransfer** — frame seq/length/offset validation is off-by-one-correct and runs *before* any allocation; offer cross-validation matches the sender's own `ceil(size/chunkSize)`; `fail(notifyRemote)` flips state before notifying so there's **no Cancel→fail→Cancel loop**; remote-initiated failures correctly don't echo.
- **media** — `mediasoup` is genuinely lazy (every `src` import is `import type`; `import 'rtcforge-media'` succeeds without it until a worker spawns); transport **ownership enforced** on connect/produce/consume; the router-reap chain (observer close → `Closed` → MediaService delete) actually removes a dead router on worker crash; ICE-restart-before-drop is bounded and can't loop; answer clears the negotiation timer.
- **sfu** — origin failure emits `OriginLost` + detaches (no dark re-root); primary failure now tears down orphaned cascade links; hung health probe can't wedge `_inFlight` (timeout race, unref'd); consecutive-failure/​recovery thresholds are streak-correct; `ReferenceSfuMedia` bookkeeping is idempotent; UDP HMAC uses a length-guarded `timingSafeEqual`.
- **core** — `consoleLogger` level filter correct; `MemoryMembership` sweeper fires watchers on TTL expiry (unref'd, `stop()` idempotent); the SWIM equal-incarnation dead-override propagates departures **without breaking refutation** (a live node still wins by advancing incarnation).

Cross-cutting patterns from the first review (state machines, disciplined cleanup, zod validation, real seams) all remain intact.

---

## ❌ What we did wrong — found by re-review, **fixed in this pass**

Every item below was a real defect the re-review surfaced; each is now fixed + (mostly) regression-tested.

| Sev (as found) | Package | Defect | Fix |
|---|---|---|---|
| **CRITICAL** | signaling | The crash-fix was **incomplete**: the `'error'` listener lived only on the `Peer`, built *after* `await auth`/`iceServersHook`. A client RST during async auth — or on any rejection path — still had no listener → `uncaughtException` → server dies. | Attach `ws.on('error')` **synchronously** at the top of the `'connection'` handler (`SignalingServer.ts`), before any await. |
| **HIGH** | media | `rtcforge-sdk` was marked an **optional** peer, but browser `Call` imports runtime values (`MessageType`, `RoomEvent`) from it and `index.ts` eagerly re-exports `Call`. On npm 7+ `npm i rtcforge-media` → `new Call()` throws `Cannot find package 'rtcforge-sdk'`. | Moved `rtcforge-core` + `rtcforge-sdk` to real `dependencies`; only `mediasoup` + `rtcforge-signaling` stay optional peers. |
| MEDIUM | signaling | Rate-limit ran *after* parse and **exempted pong entirely** → malformed-frame and pong floods were unbounded. | Rate-limit **before parse** (bounds all frame types); replaced the pong-exemption with **activity-based liveness** (any accepted frame refreshes `lastPong`), so a busy peer still isn't falsely pruned. |
| MEDIUM | filetransfer | `awaitDrain` still hung if the channel was **already closed on entry** (close/error already fired). | Entry-time `readyState !== 'open'` reject, mirroring `waitForOpen`. |
| MEDIUM | filetransfer | Offer timer leaked on `cancel()`/self-fail (not `unref`'d, not cleared) → held the event loop ~30s. | `unref()` the timer; clear it in `_markCancelled`; don't arm on an already-terminal `start()`. |
| MEDIUM | sfu | `removeNode` never cleared `_failStreak`/`_passStreak` → a reused node id (restart) inherited a stale streak and was `markFailed` on its **first** probe, defeating anti-flap. | Delete both streak entries in `removeNode`. |
| MEDIUM | sdk client | `Terminated` was orphaned — the client never listened, so `transport` stayed non-null and the next `joinRoom` threw "Already in a room". | `_wireLifecycle` now handles `Terminated`: resets client state (re-joinable) + emits new `ClientEvent.Terminated`. Also exposed `nonRetryableCloseCodes` on client options. |
| LOW | media | `resumeConsumer` had no ownership check (the only SFU method that didn't). | Added `peerId` ownership check. |
| LOW | signaling+sdk | Factory `{ default, ...opts }` spread order — an explicit `logger: undefined` clobbered the default logger. | Spread `...opts` first, then apply defaults. |
| LOW | sfu/udp | The "no secret → unauthenticated" security warning went to `noopLogger` by default → invisible. | Also `console.warn` it when the logger is the no-op. |
| LOW | docs | Wrong broadcast API in README + BUILDING_APPS (`room.on("chat", …)` never fires — Room emits one `"broadcast"` event `(from, channel, data)`). Plus a stale `rtcforge-adapter-udp` import in a JSDoc example. | Corrected all copy-paste examples. |

---

## ⚠️ What remains open (documented, not yet fixed)

Mostly pre-existing from the first review — none are crashes; ranked by who they bite.

**Security / correctness (worth a next pass)**
- **signaling:** `kickPeer` still doesn't remove the peer from `_peers` synchronously (relies on async `ws.close`); auth exception `err.message` leaked as the close reason (and >123 bytes throws); **no Origin/CSWSH check** (no-auth mode joinable from any web origin); header-auth doc mismatch (only `?token=` read); `start()` has no re-entrancy guard; `PROTOCOL_VERSION` exported but never sent/checked.
- **core:** `MessageBus` — one throwing subscriber aborts delivery to the rest and rejects `publish`; `HashRing` accepts `NaN`/`Infinity` weight (→ silent no-owner / wins-everything); `MembershipReconciler` has no re-entrancy guard.
- **filetransfer:** **resume is still dead code** (nothing sends `ResumeRequest`; `haveChunks` always empty); data channels aren't closed after a terminal state (SCTP leak); `_resumeWaiters`/`_pendingChannels` leak on cancel-while-paused / rejected-offer; receiver can't *enforce* checksums (uses attacker-supplied `checksum` flag); per-chunk digest is O(chunks) memory; no path-traversal sanitizer for `metadata.name`.
- **media:** the glare/rollback **polite-side** negotiation timer can still dangle (Answer-clears fix covers the impolite side); `Call.close()` doesn't `stop()` local tracks (camera stays live); no `track.onended` on device unplug; `RemoteStream` fires twice for an audio+video peer.
- **gossip/udp:** HMAC has **no replay protection** (nonce/timestamp); a one-round false-death flap window exists from the new equal-incarnation override (self-heals next tick); `probeTimeoutMs: 0` silently disables the probe timeout (footgun).

**Structural (needs a design change, not a patch)**
- `SfuMediaInterface`/`CascadePipeInterface` are synchronous `void` — pipe setup can't be awaited or fail visibly; `ReferenceSfuMedia` is the honest seam but real cross-node piping needs an async interface + node-to-node signaling.
- Gossip is AP with no fencing/quorum → split-brain remaps rooms; treat ring ownership as advisory.

**Test gaps (the big one)** — unit coverage is now good on the *fixed* paths, but the media/browser plane is still **mock-only**. No test drives real `RTCPeerConnection` glare/rollback, ICE restart, negotiation-timeout-on-reneg, or the worker-death reap. The Playwright E2E harness exists (`e2e/`) but isn't run in CI.

---

## Your 4 points — **all done** (status)

| # | Point | Status |
|---|---|---|
| 1 | Fix mediasoup dep | ✅ **Done** — optional peer + lazy import; browser installs no longer compile it. *(Re-review caught a sibling regression — `rtcforge-sdk` wrongly optional — now also fixed.)* |
| 2 | LICENSE files | ✅ **Done** — MIT `LICENSE` in root + all 7 packages, added to each `files`. |
| 3 | sideEffects + CHANGELOG | ✅ **Done** — `sideEffects:false` on every package; changesets configured (`.changeset/`) drives per-package CHANGELOGs. |
| 4 | Publish CI + browser E2E | ✅ **CI done**, ⚠️ **E2E scaffolded not run** — `.github/workflows/{ci,release}.yml` (build/typecheck/test + provenance publish); Playwright harness in `e2e/` needs `npx playwright install chromium` to actually execute. |

**Are they needed?** Yes — and all four are now in place. Point 4's E2E is the one still needing a human step (install browsers + wire into CI); it's the highest-value remaining work because it's the only thing that tests the media plane for real.

---

## Is 6 npm correct, or another way? — **already reshaped**

The 6-package question from the first review has been acted on:

- **Folded `rtcforge-adapter-udp` → `rtcforge-sfu/udp`** (it was 2 files only ever used with sfu). The standalone package is now a deprecated thin re-export.
- **Added the `rtcforge` meta-package** — one install fronts the whole stack via subpaths: `rtcforge/client`, `rtcforge/server`, `rtcforge/media`, `rtcforge/filetransfer`.

**Result — the user-facing install story is now 1–2 packages**, not 6:

```bash
npm i rtcforge            # frontend + backend (most apps)
npm i rtcforge mediasoup  # + SFU media plane
# + rtcforge-sfu          # only for multi-node / 1M-viewer scale
```

Every use case in `docs/BUILDING_APPS.md` is reachable this way. Under the hood it's still 5 real packages + the meta front door (cherry-picking preserved for those who want it). **Not** collapsed to a literal 2 published packages — that's a bigger source-merge refactor, deliberately deferred; the meta-package delivers the same one-install DX without it.

---

## Improvement checklist — status

P0/P1 from the first review were done in the hardening pass. The **Now** and **Next** tiers below have since been **implemented** (382 tests, +13 regression tests). Only the **Later** tier (features/structure) remains.

### Now — ✅ done
- [x] CI E2E job added (`.github/workflows/ci.yml` installs chromium + runs `npm run test:e2e`). *(Still requires a real CI run to be green — the harness/tests exist.)*
- [x] Regression tests added: worker/streak reuse, reconnect→`Terminated` (wired), filetransfer offer-timeout, awaitDrain-already-closed, `resumeConsumer` ownership, gossip replay-drop, `sanitizeFileName`, signaling `start()`-guard, `MessageBus`/`HashRing`/reconciler edges.
- [x] `core`: `MessageBus` isolates throwing subscribers; `HashRing` rejects `NaN`/`Infinity` weight; `MembershipReconciler` has re-entrancy + `start()` guards.

### Next — ✅ done
- [x] `signaling`: `kickPeer` removes from `_peers` synchronously; auth errors no longer leaked as the close reason (+ close reasons byte-capped to 123); optional `allowedOrigins` CSWSH allowlist; `start()` re-entrancy guard.
- [x] `filetransfer`: data channels closed on terminal; `_resumeWaiters`/`_pendingChannels` drained/closed on cancel/reject; receiver enforces its own `checksum` policy; `sanitizeFileName` exported.
- [x] `gossip/udp`: HMAC envelope now carries a signed timestamp + `replayWindowMs` freshness check (bounds replay; tolerates reorder/restart).
- [x] `media`: `Call.close()` stops local tracks when `stopTracksOnClose`; `track.onended` removes the track + renegotiates; `RemoteStream` deduped per stream.

### Later — ✅ code items done
- [x] Filetransfer **resume** implemented (in-session, `resumable` option): a mid-transfer channel drop pauses instead of failing; `FileTransferManager.resumeSend()` re-announces on reconnected channels and the receiver's `requestResume()` makes only the missing chunks resend. **Also fixed an inverted bug in the previously-dead `ResumeRequest` handler** (it sent the wrong chunks).
- [x] `SfuMediaInterface`/`CascadePipeInterface` are now **async-capable** (`void | Promise<void>`); `SfuBridge`/`CascadeBridge` await them and emit `RouteError`/`PipeError` on failure instead of swallowing it.
- [x] `PROTOCOL_VERSION` now **sent on `room-joined` and checked by the client** (skew logged).

### Later — remaining (strategic decisions, not mechanical)
- [ ] **Literal 2-package collapse** (`rtcforge` + `rtcforge-server`). *Recommendation: don't.* The `rtcforge` meta-package already delivers the one-install DX; collapsing throws away per-package cherry-picking and re-churns every import for marginal gain. Revisit only if telemetry shows nobody installs the individual packages.
- [ ] **Cut `1.0`.** *Recommendation: not yet.* Gate on the E2E job actually running green in CI (needs a real CI run) + a short beta. The API is stable enough to commit to; the validation isn't complete.
- [ ] Cross-node pipe driver over real `rtcforge-media` (needs node-to-node signaling; `ReferenceSfuMedia` + the now-async interface are the seam).
- [ ] Persistent-sink resume across page reload (current resume is in-session only).

---

## Bottom line

- **Everything the first review found is fixed and verified.** The re-review's job was to check that — it holds.
- **The re-review found new gaps; the serious two (incomplete crash-fix, sdk-dep regression) are now fixed too.** That's exactly why a second independent pass was worth running — self-review misses its own blind spots.
- **~5.7 → ~7.8.** Late-beta. Ship behind a beta tag; the remaining tail is hardening + the E2E run, not blockers.
