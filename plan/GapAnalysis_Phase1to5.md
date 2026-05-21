# Gap Analysis — Phases 1–5

> Generated: 2026-05-21 | Updated: 2026-05-21 (post-fix pass)
> Scope: What is planned vs what is implemented. Code read directly.

---

## Plan Correctness: Application-Layer Review

RTCForge is a WebRTC abstraction library. The plan must not own application-layer concerns.

### Issues Found — All Fixed ✅

#### 1. Full Wiring Example — RecordingService used server-side ✅ Fixed

`plan/HighLevelPlan.md` Full Wiring Example previously showed `RecordingService` inside a Node.js
`signaling.on('roomCreated', ...)` callback. `RecordingService` uses the browser's `MediaRecorder` API —
impossible server-side.

**Applied fix:** Removed `RecordingService` and its import from the server-side wiring block.
Added a separate browser-side client snippet showing correct usage. Added `chat.stop()` on room closed.

---

#### 2. Media Section — `peer.subscribeAll()` and `peer.on('trackPublished')` on wrong object ✅ Fixed

Plan showed these on the signaling `Peer` object. These are SFU/MediaService concerns, not signaling Peer API.

**Applied fix:** Replaced the `room.on('peerJoined', ...)` block with a TBD comment explaining that
per-peer track events and subscription are Phase 2 SFU API design (likely via a `MediaPeer` wrapper).

---

#### 3. `@rtcforge/core` missing from Layer Model and Architecture Diagram ✅ Fixed

**Applied fix:** Added `@rtcforge/core` as a named cross-cutting primitive in Layer 2 of the layer diagram,
describing it as zero-dependency, used by every package.

---

## Phase-by-Phase Gap Analysis

---

### Phase 1 — Signaling + Client SDK

**Target:** SignalingServer, Room, Peer, auth hook, in-memory room lifecycle, peer discovery, reconnection, SDK.

#### Implemented ✅

| Feature | Location |
| ------- | -------- |
| `SignalingServer` — WebSocket server, auth hook, room auto-create/close | `signaling/src/SignalingServer.ts` |
| `Room` — state machine (active→closed), peer add/remove/kick, broadcast, relay | `signaling/src/Room.ts` |
| `Peer` — WebSocket wrapper, message routing, ping/disconnect | `signaling/src/Peer.ts` |
| Auth hook — Zod-validated `AuthPayload`, throws on invalid | `signaling/src/SignalingServer.ts:155` |
| Heartbeat — configurable ping/pong with PONG_TIMEOUT eviction | `signaling/src/SignalingServer.ts:228` |
| Reconnection — existing slot replaced, not counted against `maxPeers` | `signaling/src/Room.ts:52` |
| `kickPeer(id, reason?)` | `signaling/src/Room.ts:90` |
| `maxPeersPerRoom` cap | `signaling/src/Room.ts:56` |
| `PeerRole` — host / participant / viewer | `signaling/src/types.ts` |
| `RoomState` — active / closing / closed | `signaling/src/types.ts` |
| `MetricsCollector` interface + `noopMetrics` + `Metric` constants | `core/src/types.ts` (moved from signaling) |
| `attachHealthEndpoint(server, path?)` — GET /health with stats JSON | `signaling/src/SignalingServer.ts:132` |
| `getStats()` — rooms, peers, uptime | `signaling/src/SignalingServer.ts:124` |
| `RTCForgeClient` — connect, joinRoom, exponential backoff reconnect | `sdk/src/RTCForgeClient.ts` |
| `Room` (SDK) — peers, chat, whiteboard stub, publishCamera, peer info | `sdk/src/Room.ts` |
| `ChatRoom` (SDK) — client-side send/DM/group, history, edit/delete/reaction | `sdk/src/ChatRoom.ts` |
| `WhiteboardRoom` (SDK) — stub for Phase 7 | `sdk/src/WhiteboardRoom.ts` |
| `WebSocketTransport` — connection, reconnect, tokenRefresh on reconnect | `sdk/src/WebSocketTransport.ts` |
| `tokenRefresh` — wired, called before reconnect URL construction | `sdk/src/WebSocketTransport.ts:156` |

#### Dependency Bug ✅ Fixed

**Was:** `@rtcforge/signaling` depended on `@rtcforge/sdk` for `Logger`/`noopLogger` — architecturally backwards.

**Applied fix:**
- `signaling/src/types.ts` — imports `Logger`/`noopLogger` from `@rtcforge/core`; local `MetricsCollector`/`noopMetrics`/`Metric` definitions removed, now re-exported from `@rtcforge/core`
- `signaling/package.json` — dependency changed from `@rtcforge/sdk` → `@rtcforge/core`
- `signaling/tsconfig.json` — added `@rtcforge/core` path mapping to `../core/src/index.ts`

Correct dependency graph (now implemented):
```
@rtcforge/core          (no deps)
@rtcforge/signaling  →  @rtcforge/core
@rtcforge/sdk        →  @rtcforge/core
@rtcforge/media      →  @rtcforge/core + @rtcforge/sdk
@rtcforge/chat       →  @rtcforge/core + @rtcforge/signaling
@rtcforge/recording  →  @rtcforge/core
```

#### Minor Gaps ⚠️ (unchanged — by design)

- `Room.enableMedia(onPeerJoined, onPeerLeft?)` takes plain callbacks, not a `MediaService` instance. Will diverge when SFU is implemented in Phase 2.
- `PeerRole.Viewer` is defined but media enforcement (blocking viewers from publishing) is a Phase 2 (SFU) concern, not enforced in current mesh. Documented in plan.

---

### Phase 2 — Media Package

**Target:** MediaService, MediaRouter, Worker Pool, Producer, Consumer, SFU via mediasoup.

#### Implemented ✅ (Mesh layer only)

| Feature | Location |
| ------- | -------- |
| `Call` — mesh WebRTC, manages PeerConnections per remote peer | `media/src/Call.ts` |
| `PeerConnection` — RTCPeerConnection wrapper, offer/answer/ICE | `media/src/PeerConnection.ts` |
| Polite/impolite offer collision handling (Perfect Negotiation pattern) | `media/src/PeerConnection.ts` |
| `getUserMedia`, `getDisplayMedia` | `media/src/MediaManager.ts` |
| `CallOptions` — `turn`, `codec`, `maxBitrate`, `logger`, `metrics`, `stream` | `media/src/types.ts` |
| `MediaEvent.TrackPublished` emitted on `Call.addTrack()` | `media/src/Call.ts:59` |
| `subscribeAll()` — no-op stub, compatibility shim for future SFU | `media/src/Call.ts:63` |
| `addTrack(track, stream)` — adds to all active PeerConnections | `media/src/Call.ts:54` |
| `metrics?` hook point in `CallOptions` | `media/src/types.ts` |

#### Not Implemented ❌ (SFU — main Phase 2 target)

| Feature | Status |
| ------- | ------ |
| `MediaService` class | Not started |
| `MediaRouter` | Not started |
| `Producer` | Not started |
| `Consumer` | Not started |
| mediasoup Worker Pool (spawn, balance, recover) | Not started |
| WebRTC Transport creation (DTLS, SRTP) via mediasoup | Not started |
| `mediasoup` in `media/package.json` | Not added |
| `room.enableMedia(mediaService)` server-side API | Not started |
| `peer.subscribeAll()` server-side (subscribe this peer to all room tracks) | Not started |
| SFU-based codec negotiation and bitrate control | Not started |
| Worker crash recovery | Not started |

**Phase 2 is ~25% complete.** Mesh WebRTC works and is used in the video-call example. The entire SFU layer (MediaService/mediasoup) has not been started — this is the primary Phase 2 deliverable.

---

### Phase 3 — Reliability & Observability

**Target:** Structured logging, metrics hooks, graceful shutdown, reconnection, health check.

#### Implemented ✅

| Feature | Location |
| ------- | -------- |
| `Logger` interface — debug/info/warn/error + ctx | `core/src/types.ts` |
| `noopLogger` | `core/src/types.ts` |
| `MetricsCollector` interface — increment/gauge | `core/src/types.ts` (moved from signaling) |
| `noopMetrics` | `core/src/types.ts` (moved from signaling) |
| `Metric` constants — rooms, peers, signals, auth errors, active gauges | `core/src/types.ts` (moved from signaling) |
| All three re-exported from `@rtcforge/signaling` for backward compat | `signaling/src/types.ts` |
| `metrics?` hook point in `CallOptions` | `media/src/types.ts` |
| `metrics?` hook point in `RecordingOptions` | `recording/src/types.ts` |
| `metrics?` hook point in `ChatServiceOptions` | `chat/src/types.ts` |
| `metrics?` hook point in `PresenceServiceOptions` | `chat/src/types.ts` |
| Graceful shutdown — `SignalingServer.stop()` disconnects all peers cleanly | `signaling/src/SignalingServer.ts:92` |
| SDK reconnection — exponential backoff with `maxReconnectDelay` + `maxReconnectAttempts` | `sdk/src/WebSocketTransport.ts` |
| `tokenRefresh` on reconnect | `sdk/src/WebSocketTransport.ts:156` |
| Health endpoint — `attachHealthEndpoint(server, path?)` | `signaling/src/SignalingServer.ts:132` |
| Logger passed through all packages as optional option | all packages |

#### Remaining Gaps ⚠️

| Gap | Detail |
| --- | ------ |
| Metrics call sites not wired | `metrics?` option exists in all packages but no `metrics.increment()` / `metrics.gauge()` calls inside media/chat/recording yet — hook point only |
| `RecordingHandle` emitter listener cleanup | `stopAll()` exists but EventEmitter listeners on the handle are not removed after stop — minor leak in test scenarios |

---

### Phase 4 — Chat & Presence Package

**Target:** ChatService, PresenceService, typing indicators, message store.

#### Implemented ✅

| Feature | Location |
| ------- | -------- |
| `ChatService` — server-side message routing per room | `chat/src/ChatService.ts` |
| Broadcast (all peers) | `chat/src/ChatService.ts:179` |
| Direct message (DM) — single peer | `chat/src/ChatService.ts:181` |
| Group message — multiple peers | `chat/src/ChatService.ts:190` |
| Typing indicator with debounce (configurable `typingDebounceMs`) | `chat/src/ChatService.ts:109` |
| History replay — new joiners receive filtered message history | `chat/src/ChatService.ts:104` |
| Message edit | `chat/src/ChatService.ts:223` |
| Message delete | `chat/src/ChatService.ts:233` |
| Emoji reaction | `chat/src/ChatService.ts:242` |
| Read receipt — sender notified when message read | `chat/src/ChatService.ts:248` |
| Delivered receipt | `chat/src/ChatService.ts:207` |
| Role-based send restriction (`sendRoles` option) | `chat/src/ChatService.ts:125` |
| Offline message callback (`onOfflineMessage`) | `chat/src/ChatService.ts:185` |
| `PresenceService` — online/offline events, `getOnline()` | `chat/src/PresenceService.ts` |
| `onLastSeen` callback on peer leaving | `chat/src/PresenceService.ts:35` |
| `InMemoryMessageStore` — pluggable via `MessageStore` interface | `chat/src/MessageStore.ts` |
| Media attachments in messages (`MediaAttachment[]`) | `signaling/src/protocol.ts:39` |
| `ChatService.stop()` — removes room listeners, clears typing timers | `chat/src/ChatService.ts` |

#### Dependency Warning ✅ Fixed

**Was:** `chat/src/types.ts` imported `Logger`/`noopLogger` from `@rtcforge/signaling` (which got them from `@rtcforge/sdk`).

**Applied fix:**
- `chat/src/types.ts` — imports `Logger`/`noopLogger`/`MetricsCollector` from `@rtcforge/core` directly; `MediaAttachment`/`PeerRole` remain from `@rtcforge/signaling`
- `chat/package.json` — added `@rtcforge/core: "*"` as direct dependency
- `chat/tsconfig.json` — added `@rtcforge/core` path mapping to `../core/src/index.ts`

#### Minor Gaps ✅ Fixed

- `ChatService.stop()` — added. Stores `onPeerJoined`/`onPeerLeft` as named private fields; `stop()` calls `room.off()` with those references and clears all typing timers and wiredPeers.

---

### Phase 5 — Recording Package

**Target:** RecordingService, RecordingHandle, full lifecycle, raw Blob delivery.

#### Implemented ✅

| Feature | Location |
| ------- | -------- |
| `RecordingService` — factory: `start(stream, opts)` → `RecordingHandle` | `recording/src/RecordingService.ts` |
| `activeCount` | `recording/src/RecordingService.ts` |
| `stopAll()` | `recording/src/RecordingService.ts` |
| `RecordingHandle` — wraps `MediaRecorder`, full lifecycle | `recording/src/RecordingHandle.ts` |
| `start()` — MIME type validation before recorder start | `recording/src/RecordingHandle.ts` |
| `pause()` / `resume()` | `recording/src/RecordingHandle.ts` |
| `stop()` — returns `Promise<RecordingCompleteEvent>` | `recording/src/RecordingHandle.ts` |
| Events: `data`, `complete`, `error`, `pause`, `resume` | `recording/src/types.ts` |
| Chunk buffering → final `Blob` assembly | `recording/src/RecordingHandle.ts` |
| Duration tracking — excludes paused time | `recording/src/RecordingHandle.ts` |
| Track `ended` listener cleanup (no leak) | `recording/src/RecordingHandle.ts` |
| `metrics?` hook point in `RecordingOptions` | `recording/src/types.ts` |
| Imports from `@rtcforge/core` (correct — no sdk dependency) | `recording/package.json` |

#### Phase 5 Complete ✅

---

## Summary Table

| Phase | Status | Completion | Primary Gap |
| ----- | ------ | ---------- | ----------- |
| 0 — Core primitives | ✅ Complete | 100% | — |
| 1 — Signaling + SDK | ✅ Complete | 100% | ~~signaling depends on sdk~~ fixed |
| 2 — Media | 🔴 Partial | 25% | MediaService/SFU/mediasoup not started |
| 3 — Reliability | ✅ Mostly done | 85% | metrics call sites not wired (hook points exist) |
| 4 — Chat + Presence | ✅ Complete | 100% | ~~Logger wrong chain~~ fixed, ~~no stop()~~ fixed |
| 5 — Recording | ✅ Complete | 100% | — |

---

## Action Items — Status

### P0 — Architectural ✅ All Done

| # | Item | Status |
| - | ---- | ------ |
| 1 | Fix signaling→sdk dependency | ✅ Done |
| 2 | Fix chat Logger chain | ✅ Done |
| 3 | Fix plan Full Wiring Example (server-side recording) | ✅ Done |
| 4 | Fix plan Media section (peer.subscribeAll on wrong object) | ✅ Done |

### P1 — Before Phase 6 ✅ All Done

| # | Item | Status |
| - | ---- | ------ |
| 5 | Move MetricsCollector to `@rtcforge/core` | ✅ Done |
| 6 | `ChatService.stop()` cleanup | ✅ Done |

### P2 — Documentation ✅ All Done

| # | Item | Status |
| - | ---- | ------ |
| 7 | Add `@rtcforge/core` to Layer Model | ✅ Done |
| 8 | Clarify PeerRole.Viewer enforcement is Phase 2 concern | ✅ Done |

---

## Remaining Open Items (carry to Phase 2 planning)

1. **Phase 2 SFU** — `MediaService`/mediasoup entire implementation. Primary Phase 2 deliverable. ~75% remaining.
2. **Metrics call sites** — `metrics?` hook exists in all packages but no actual `increment()`/`gauge()` calls inside media/chat/recording. Wire in Phase 3 follow-up pass.
3. **RecordingHandle emitter listener cleanup** — `stopAll()` exists but EventEmitter listeners on individual handles are not removed after stop. Minor — address when revisiting recording package.
