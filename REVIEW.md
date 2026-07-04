# RTCForge — Full Package Review

**Scope:** All 6 published packages, every class file (~70 source files, 342 tests).
**Commit:** `f9e3c5a` · **Version reviewed:** `0.1.2` · **Date:** 2026-07-04
**Method:** 6 parallel senior-reviewer passes (one per package/module), all CRITICAL findings re-verified against source.

---

## TL;DR

RTCForge is **well-architected and cleanly typed** — real seams, state machines with legal-transition tables, disciplined timer/listener cleanup, zod-validated wire protocols. The *design* is genuinely good.

But it is **not production-ready at `0.1.2`**. Every package has correctness holes in its **failure paths** — the exact paths that matter for real-time infra. Three are outright **crash / hang / total-outage** bugs. The tests are green because they mock the network and exercise the happy path; the bugs live where the mocks don't reach (real socket errors, backpressure, node death, hostile input).

**Your instinct is right that 6 npm packages is friction — but that is not the top problem.** The top problem is ~5 blocker bugs and a security-open default posture. Fix correctness first, packaging second.

### Scorecard

| Package | Score | Verdict | Blockers |
|---|---|---|---|
| `rtcforge-core` | 6/10 | Clean primitives, but membership/gossip failover is invisible to watchers; stores leak under churn | 2 HIGH |
| `rtcforge-adapter-udp` | 5/10 | Works, but ships an **unauthenticated** cross-host UDP protocol (poisoning + reflection) | 2 HIGH |
| `rtcforge-signaling` | 5.5/10 | 3-line bootstrap, strong typing — but **1 remote crash**, a room-registry race, no payload/room caps | **1 CRITICAL** + 3 HIGH |
| `rtcforge-sdk` (client) | 6.5/10 | Best of the set; real seams — but reconnect has holes + token leaks into logs | 3 HIGH |
| `rtcforge-sdk` (filetransfer) | 5.5/10 | Correct happy path — but **hangs on peer disconnect**, dead resume feature, trusts remote sizes | **1 CRITICAL** + 4 HIGH |
| `rtcforge-media` | 6/10 | Thin, competent P2P core — but renegotiation timer kills healthy calls; dead router after worker crash | 4 HIGH |
| `rtcforge-sfu` | 5/10 | Good lifecycle hygiene — but **dead-origin = dark broadcast**, flapping, and it moves **zero media** | **1 CRITICAL** + 4 HIGH |

**Overall: ~5.7/10.** Solid bones, unsafe under failure. Roughly a *late alpha* — the API surface is worth committing to; the internals need a hardening pass before anyone builds a business on it.

---

## 🔴 Blocker bugs (fix before anyone builds on this)

All verified against source at `f9e3c5a`.

### CRITICAL — 3

1. **Any client can crash the whole signaling server.**
   `packages/signaling/src/Peer.ts:79-80` attaches only `'message'` and `'close'` listeners to each client socket — **never `'error'`**. (The `'error'` handlers at `SignalingServer.ts:166,180` are on the *server* socket, not per-client.) `ws.WebSocket` is a Node `EventEmitter`, so one `ECONNRESET` or one malformed frame from any client emits `'error'` with no listener → `uncaughtException` → **process dies**. Trivially remotable DoS.
   *Fix:* attach `this.ws.on('error', …)` in `Peer` (log + close that peer).

2. **File transfer hangs forever when a peer drops under backpressure.**
   `packages/sdk/src/filetransfer/channel.ts:40-54` — `awaitDrain` registers only a `bufferedamountlow` listener, **no `close`/`error`**. Peer disconnects while `bufferedAmount > highWaterMark` → the event never fires → the send worker awaits forever, stuck in `Active`, no error surfaced. Cancel can't unblock it (terminal check is *after* the await).
   *Fix:* add close/error listeners inside `awaitDrain` that reject; abort the worker on reject.

3. **SFU broadcast goes permanently dark when the origin node fails.**
   `packages/sfu/src/CascadeTree.ts:249-254` — `_onNodeGone` calls `build(roomId, room.originId, …)` unconditionally, and `planCascadeTree` (`:119-126`) seats `originId` as root with **no health check**. Origin dies → the tree is rebuilt rooted at the dead node, `TreeBuilt` reports success, the dead node is even re-tracked. Whole broadcast stays dark.
   *Fix:* on origin failure, either promote a healthy relay to root or emit an unrecoverable event — never re-root on a known-dead node.

### HIGH — the ones most likely to bite in production

| # | Package | File:line | Failure |
|---|---|---|---|
| 4 | signaling | `SignalingServer.ts:369-375` | Last peer leaves during `await iceServersHook` → room closes, but `addPeer` (`Room.ts:146`) has no state check → peer admitted to a **zombie closed room**; its later close evicts a *new* same-id room with live peers (`RoomRegistry.ts:52-55`). |
| 5 | signaling | `SignalingServer.ts:160-164` | No `maxPayload` (ws default 100 MiB), no room/connection cap, rate-limit **off by default** (`types.ts:330`) → one client OOMs the server. |
| 6 | sdk-client | `WebSocketTransport.ts:137,187` | Auth token rides the socket URL and is logged verbatim (`logger.info('WebSocket connected', { url })`) → JWTs shipped to log aggregators + proxy access logs. |
| 7 | sdk-client | `WebSocketTransport.ts:151-165` | Reconnect ignores close codes → token expires mid-session (server closes 1008/4001) → client retries the **same dead token forever** (default unlimited attempts), no terminal signal. |
| 8 | sdk-client | `JoinHandshake.ts:57` → `RTCForgeClient.ts:97` | Message-loss window: the only `message` listener is removed on handshake settle, steady-state re-attaches after an `await`. In Node, `ws` delivers frames from one TCP segment synchronously → a `signal`/`peer-joined` right after `room-joined` is **dropped → SDP offer lost → call never establishes**. |
| 9 | media | `Call.ts:420-423,350-352` | `negotiationTimeoutMs` timer is cleared only on connection *state change*, never when the answer arrives. Mid-call renegotiation (addTrack/screen-share) on an already-`connected` PC fires no state change → timer expires → **healthy call torn down** as "Negotiation timeout". |
| 10 | media | `MediaService.ts:41-43` | Worker crash: `WorkerPool` respawns the process but `MediaService` keeps the **dead `MediaRouter`** in `_routers`; every later `createWebRtcTransport` throws → room bricked until close. |
| 11 | media | `package.json:39` | `mediasoup` is a **hard dependency** → every browser-only consumer's `npm install` downloads & compiles a 7.4 MB native worker binary it never uses (and fails CI on unsupported platforms). |
| 12 | media | `MediaRouter.ts:102-150` | `connectTransport`/`produce`/`consume` never check transport ownership against `appData.peerId`, and SFU ingress DTLS/RTP params get **no zod validation** → peer A can connect peer B's transport if the id leaks over signaling. |
| 13 | filetransfer | `ReceiveTransfer.ts:212-235` | Receiver never validates frame `seq`/length against the offer → malicious `seq=4e9` → ~64 TB alloc (`MemorySink`) or file extended to `seq*chunkSize` (`NodeFileSink`) → **disk/memory exhaustion**. |
| 14 | filetransfer | `FileTransferManager.ts:241-251` | Offer fields never cross-validated → `size=1TB` → 1 TB alloc at accept; `totalChunks:0` with `size>0` → instantly "completes" an empty file as success. |
| 15 | filetransfer | `Transfer.ts:169-175` | Local `fail()` never notifies the remote → sink write failure (disk full) fails the receiver silently while the sender streams the whole file then waits for `Complete` **forever**. |
| 16 | filetransfer | `SendTransfer.ts:128` etc. | **Resume is dead code**: nothing ever sends `ft-resume-request`; `haveChunks` is always `[]`. Any channel drop = start over (→ in practice, the CRITICAL hang). |
| 17 | sfu | `CascadingRouter.ts:68-77` | Cascade-link leak on primary failure: assignment cleared but `_cascadeLinks` left intact → cascade nodes track the room forever, wedging `drain()`. |
| 18 | sfu | `SfuCluster.ts:187-200` | **No consecutive-failure threshold**: one failed health probe → all rooms detached + every tree rebuilt; one pass → recovered → a single timeout triggers a cluster-wide migration storm. |
| 19 | sfu | `HealthChecker.ts:39-48` | A hung `onCheck` (no timeout wrapper) leaves the id in `_inFlight` forever → that node is skipped on every future sweep, never failed *or* recovered. |
| 20 | core | `Membership.ts:63-96` | `_prune()` runs only inside `list()`; `watch` fires only on register/deregister → a silently-crashed node whose TTL lapses **never triggers `watch`/reconciler `onRemove`** unless something polls `list()`. The advertised failover detection is invisible to pure watch consumers. |
| 21 | core | `Gossip.ts:110-118` | `deregister` of a remote node bumps `incarnation` off the stale local value → claim ignored by peers → next inbound gossip **revives the node**. Deregistering a live remote silently fails. |
| 22 | adapter-udp | `UdpGossipTransport.ts:240-280` | **No auth/HMAC on gossip** → anyone who can send UDP to the port injects membership (evict live nodes via high-incarnation `alive:false`, or inject phantoms). |
| 23 | adapter-udp | `UdpGossipTransport.ts:206-209` | Injected `address` values are re-broadcast verbatim → cluster becomes a **UDP reflection/amplification vector** toward any named victim. |

---

## ✅ What's done right (cross-cutting)

These patterns recur across packages and are genuinely good — keep them, and hold new code to the same bar.

- **State machines with explicit legal-transition tables** — `RTCForgeClient`, `Room` (both sides), `Transfer`. Illegal transitions are guarded, not just hoped-away.
- **Disciplined resource cleanup** — timers `unref()`'d (`HeartbeatMonitor`, `HealthChecker`, `StatsCollector`), listeners tracked in `_cleanups` arrays and removed on every path including error/leave.
- **zod-validated wire protocols** — every inbound frame validated before reaching app code (signaling both directions, sdk transport, filetransfer control plane, media browser signals).
- **Server-stamped identity** — signaling stamps `from` server-side, so clients can't spoof sender.
- **Real seams for testability** — `BackoffStrategy`, `MessageQueue`, `TransportFactory`, `PeerConnectionFactory`, structural `RoomLike`. Easy to inject/mock.
- **Genuinely thin abstractions where it counts** — `Call` self-wires to a `Room` (a 1:1 video call is ~6 lines); SFU is a thin mediasoup wrapper, not a reimplementation.
- **Correct core algorithms** — rendezvous `HashRing` (determinism, minimal disruption, weighted, replicas) and the bandwidth-estimator hysteresis are both correct and well-tested.
- **Backpressure done the right way** — filetransfer uses `bufferedAmount`/`bufferedamountlow` with sane defaults (the *hang* is a missing listener, not a wrong model).

## ❌ What's done wrong (cross-cutting patterns)

The individual bugs above cluster into **five systemic themes**:

1. **"Drop / retry forever" is the universal failure policy.** media drops the whole PeerConnection on any error with no local re-offer; sdk retries a dead token infinitely; filetransfer hangs instead of failing; sfu re-roots on dead nodes. **Failure paths lack a *terminal, observable* state.** Apps can't tell "transient" from "dead."
2. **Remote/peer input is trusted.** filetransfer trusts `seq`/`size` (→ OOM), media doesn't check transport ownership, adapter-udp has no auth at all. Everything that crosses the wire from an untrusted peer needs bounds + ownership checks.
3. **Unsafe-by-default posture.** Rate limit off, no `maxPayload`, no room/connection caps, no Origin check, gossip unauthenticated, optimistic bandwidth default. Safe defaults should ship **on**, not opt-in.
4. **Secrets in URLs.** Tokens ride the query string (sdk + signaling) into logs and proxies.
5. **Failover is theater in several places.** core TTL-expiry doesn't fire watchers; sfu re-roots on dead origin; media doesn't recover from worker death. The recovery *code exists* but doesn't fire on the real trigger.

---

## 📦 The 6-npm question: is this the right shape?

**Short answer: the runtime split is sound, but 6 is one too many, and the install DX is the real pain — not the count.**

### Why the split exists (and is partly correct)
You *cannot* collapse everything into one package. The hard constraint is **runtime + bundle boundaries**:
- `core` is browser-safe zero-dep → must not pull node built-ins.
- `sdk` ships to the **browser** → every KB counts, must not pull `ws`/`mediasoup`.
- `signaling` is **node-only** (WebSocket server).
- `media` pulls **`mediasoup`, a 7.4 MB native addon** → must be separable or it poisons browser installs (bug #11).
- `sfu` + `adapter-udp` are **scale-out**, needed by <5% of users.

Merging across those boundaries would bloat the browser bundle or break installs. So *some* split is mandatory.

### Where it's wrong
1. **`adapter-udp` should not be its own package.** 2 files, only ever used *with* `sfu`. Fold it into `rtcforge-sfu` as a subpath export (`rtcforge-sfu/udp`) — that's 6 → 5 with zero downside.
2. **`media`'s peer deps are the worst DX in the repo.** Users must run `npm i rtcforge-media rtcforge-core rtcforge-sdk rtcforge-signaling` — 4 packages, peer deps *not auto-installed*, easy to get versions wrong.
3. **All 6 are lockstepped at `0.1.2` with `^0.1.0` interdeps.** They release together anyway → the independent-versioning benefit of separate packages is unused, so you pay the split's cost without its upside.

### Recommendation: publish the bare name `rtcforge` as a meta-package
**`rtcforge` is FREE on npm** (verified: 404). Grab it. Make it a thin meta-package that re-exports the common trio behind subpaths:

```jsonc
// rtcforge/package.json
{
  "name": "rtcforge",
  "dependencies": {
    "rtcforge-sdk": "0.1.2",
    "rtcforge-signaling": "0.1.2",
    "rtcforge-media": "0.1.2"   // media itself keeps mediasoup optional — see fix #11
  },
  "exports": {
    "./client":    "./client",     // → rtcforge-sdk        (browser)
    "./server":    "./server",     // → rtcforge-signaling  (node)
    "./media":     "./media",      // → rtcforge-media
    "./filetransfer": "./ft"       // → rtcforge-sdk/filetransfer
  }
}
```

Result:
- **80% of users:** `npm i rtcforge` — one install, `import { RTCForgeClient } from 'rtcforge/client'`.
- **Advanced/scale-out:** still install `rtcforge-sfu` directly (rare, deliberate).
- Individual `rtcforge-*` packages stay published for people who want to cherry-pick.

**Net: keep 5 underlying packages (after folding `adapter-udp` into `sfu`), add `rtcforge` as the front door.** Best of both — clean boundaries under the hood, one-install DX on top.

---

## 🎛️ "Simple npm config to integrate" — the wiring, not just the install

Installing is only half the friction. The other half is the **glue the user must hand-write**. Biggest offenders and the fix:

| Friction today | Proposed default |
|---|---|
| README examples are **wrong** (see below) — first copy-paste fails | Fix them (P0, free) |
| Rate limit / payload cap / room cap are opt-in | Ship **safe defaults on**, let users raise them |
| `media` ↔ `Room` SFU wiring is 100% hand-rolled (caps→transport→connect→produce→consume protocol) | Ship a `MediaSignal` handler like the P2P `Call` already has |
| `sfu` needs the user to wire membership + `onCheck` probe + `onRebalance` + both media interfaces + remember `startHealthChecks()` | Default the probe to membership liveness; ship a reference `SfuMediaInterface` over `rtcforge-media` |
| No console logger by default → silent drops are invisible | Default a `warn`-level console logger |

**One concrete "simple config" win:** a `createServer()` / `createClient()` factory that bundles the sane defaults, so the quickstart is *actually* what people paste:

```ts
// server — one call, safe defaults on
import { createSignalingServer } from 'rtcforge/server'
const server = await createSignalingServer({ port: 3001, auth })  // rateLimit, maxPayload, caps all default-on

// client — one call
import { createClient } from 'rtcforge/client'
const room = await createClient({ serverUrl, token }).join('room-1')
```

---

## 🩹 Your 4 hygiene points — are they needed?

Yes, all four — **but none of them is the top priority.** They're hygiene; the blockers above are correctness. Ranked honestly:

| # | Point | Needed? | Priority | Why |
|---|---|---|---|---|
| 1 | Fix `mediasoup` dep | **Yes — real bug** (#11) | **P1** | Breaks browser installs (7.4 MB native compile). Move to `optionalDependencies` **and** split the server plane so `./browser` never resolves it. |
| 2 | LICENSE files | **Yes** | **P1** | `"license":"MIT"` is set but **zero LICENSE files** ship in any tarball → legal/scanner flag. Cheap: add `LICENSE` per package. |
| 3 | `sideEffects` + CHANGELOG | Partly | **P2** | `sideEffects:false` — yes, cheap tree-shaking win for browser (`sdk`, `core`). CHANGELOG — yes but lower; auto-generate via changesets when you add CI. |
| 4 | Publish CI + browser E2E | **Yes** | **E2E = P1, CI = P2** | **Browser E2E is important, not optional** — *every* media/sdk bug above (glare, negotiation timeout, reconnect gap, backpressure hang) survived because tests mock `RTCPeerConnection`. A real headless-Chrome pass would have caught them. Publish CI + provenance is process polish (P2). |

**Reframe:** your 4 points are all *packaging/process*. The review says the actual gating issue is **correctness in failure paths**. Do the blockers first; the 4 points are the next layer.

---

## ✅ Prioritized improvement checklist

Ordered so each tier is shippable on its own. **P0 gates any production use.**

### P0 — Blockers (correctness / security) — *do before anyone builds on it*
- [ ] **signaling:** attach `'error'` listener to every client socket (`Peer.ts`) — stops remote crash (#1)
- [ ] **filetransfer:** add close/error listeners in `awaitDrain`; abort worker on reject (#2)
- [ ] **sfu:** don't re-root cascade on a dead origin — promote a healthy relay or emit unrecoverable (#3)
- [ ] **signaling:** state-check in `addPeer` + identity-check in registry delete → kill the zombie-room race (#4)
- [ ] **signaling:** set `maxPayload`, default room/connection caps, **rate limit on by default** (#5)
- [ ] **filetransfer:** validate remote `seq`/length/`size`/`totalChunks` against the offer before allocating (#13, #14)
- [ ] **media:** validate SFU ingress params + check transport ownership by `appData.peerId` (#12)
- [ ] **adapter-udp:** add HMAC/shared-secret auth on gossip; document "trusted segment only" loudly (#22, #23)
- [ ] **sdk + signaling:** stop logging the token-bearing URL; prefer `Sec-WebSocket-Protocol`/subprotocol or first-message auth over query string (#6)

### P1 — Correctness (failure paths) + packaging
- [ ] **media:** clear negotiation timer when the answer arrives, not only on state change (#9)
- [ ] **media:** drop dead `MediaRouter` from `_routers` on worker death; re-emit `WorkerDied` (#10)
- [ ] **media:** make `restartIce()` reachable from `Call` before full teardown (#9 sibling)
- [ ] **media:** move `mediasoup` → `optionalDependencies`; split server plane so `./browser` never imports it (#11)
- [ ] **sdk:** honor close codes — terminal state on 1008/4001, cap retries, emit a distinct "gave up" event (#7)
- [ ] **sdk:** close the handshake→steady-state message gap (buffer or attach steady-state listener before settling) (#8)
- [ ] **filetransfer:** propagate local `fail()` to the remote peer; add offer/transfer timeouts (#15, #16)
- [ ] **sfu:** consecutive-failure threshold before migration; wrap `onCheck` in a timeout (#18, #19)
- [ ] **sfu:** clear `_cascadeLinks` on primary failure (#17)
- [ ] **core:** fire `watch`/reconciler `onRemove` on TTL expiry (sweeper or timer), not only on explicit deregister (#20)
- [ ] **core:** fix `deregister(remote)` incarnation so it isn't revived by the next gossip (#21)
- [ ] **LICENSE** file in every package (point #2)
- [ ] Fold **`adapter-udp` into `sfu`** as `rtcforge-sfu/udp` (6 → 5 packages)
- [ ] Publish **`rtcforge`** meta-package (bare name is free) with `./client` `./server` `./media` subpaths
- [ ] Add browser **E2E** (headless Chrome / Playwright) for media + reconnect — the bug net that mocks can't provide (point #4)

### P2 — DX / integration ("without user hassle")
- [ ] **Fix the README examples — they're wrong and fail on first paste:**
  - signaling README auth returns `{ peerId }` only → fails `AuthPayloadSchema` → every connection closes 1008
  - sdk README `room.on("peer-joined", peer => peer.id)` → payload is a `string`, logs `undefined`
  - adapter-udp + sfu quickstarts never call `listen()` / `startHealthChecks()` → do nothing
- [ ] `createSignalingServer()` / `createClient()` factories bundling safe defaults
- [ ] Ship a `MediaSignal` SFU handler so `MediaService` ↔ `Room` wiring matches the automatic P2P `Call` (kill the hand-rolled protocol)
- [ ] Ship a reference `SfuMediaInterface` over `rtcforge-media` (the missing keystone — sfu currently moves zero media)
- [ ] Default a `warn`-level console logger so silent drops/validation failures are visible out of the box
- [ ] `sideEffects: false` on browser packages (`core`, `sdk`) (point #3)
- [ ] Export `ClientMessageSchema`/`ServerMessageSchema` + a `port` getter (signaling); add `client.room` getter (sdk)
- [ ] Add `engines` + a `test` script to every package's `package.json`

### P3 — Process / polish
- [ ] Publish CI with `--provenance` + changesets-driven CHANGELOG (points #3, #4)
- [ ] Evaluate `zod/mini` or hand-rolled guards for the ~11 sdk message shapes (browser bundle weight)
- [ ] JSDoc the least-documented, most-error-prone code: `Gossip`, `MembershipReconciler`, `CascadeBridge`, `HealthChecker`
- [ ] Add a wire **protocol-version field** (signaling frames + filetransfer offer) for forward-compat
- [ ] Tests for the untested failure paths behind the P0/P1 bugs (heartbeat/rate-limiter, worker-kill, glare/rollback, reconnect→rejoin→flush, backpressure-then-close, hostile filetransfer input, origin failure, gossip partial-connectivity)

---

## Test reality check

342 tests, but they are **happy-path + mocked-network**. Concretely:
- `MockDataChannel` keeps `bufferedAmount = 0` → backpressure and the CRITICAL hang are never exercised.
- PC mocks don't define `addTransceiver` → simulcast path would throw if reached.
- No abrupt-disconnect / `ws.terminate()` test → the CRITICAL server crash is invisible.
- No glare/rollback test though glare is the *hot path* on every join.
- sfu self-heal test explicitly picks a **non-origin** victim → the CRITICAL dead-origin bug is dodged by the test itself.

The green suite is real coverage of the code that works, and **near-zero coverage of the code that fails** — which is exactly where a real-time library lives or dies. Closing that gap (P3, driven by the P0/P1 fixes) is what turns the score from ~5.7 into shippable.
