# RTCForge — Gap Analysis

> **As of:** 2026-05-17  
> **Phases complete:** 1, 2, 3, 4  
> **Next phase:** 5 (Recording)

This document audits what is actually built against what was planned, identifies every gap found within completed phases, and flags gaps that are **not covered by any upcoming phase**.

---

## How to Read This Document

- **Within-phase gap** — planned for a completed phase but not yet implemented
- **Cross-phase gap** — API inconsistency between two completed packages
- **Unlisted gap** — not mentioned in any phase in HighLevelPlan.md; needs to be added to the roadmap
- **Phase 5–9 gap** — correctly deferred; listed here for completeness only

---

## Summary Table

| Area | Status | Gaps Found | Covered by Future Phase? |
|------|--------|-----------|--------------------------|
| `@rtcforge/signaling` | ✅ Complete | 4 gaps | Partially |
| `@rtcforge/sdk` | ✅ Complete | 5 gaps | Partially |
| `@rtcforge/media` | ✅ Complete (mesh) | 6 gaps | Phase 6 covers SFU only |
| `@rtcforge/chat` | ✅ Complete | 4 gaps | No |
| `@rtcforge/recording` | ❌ Stub | 100% missing | Phase 5 ✅ |
| `@rtcforge/streaming` | ❌ Stub | 100% missing | Phase 6 ✅ |
| `@rtcforge/whiteboard` | ❌ Stub | 100% missing | Phase 7 ✅ |
| `cli/` | ❌ Stub | 100% missing | Phase 8 ✅ |
| `docs/` | ❌ Empty | 100% missing | Phase 8 (partial) |
| Examples | ⚠️ 2 of 4 empty | live-stream-app, whiteboard-app | Phase 6/7 ✅ |
| Test coverage | ⚠️ Shallow | media has 5 tests, no integration tests | **Not listed anywhere** |

---

## Phase 1 — Signaling + SDK Gaps

### `@rtcforge/signaling`

#### GAP-S-01 · No peer kick/ban — UNLISTED
The `Room` class has no way to forcibly remove a peer (moderator use case).  
`room.removePeer()` exists internally but is not exposed in the public API.  
**Not mentioned in any phase.** Needs to be added to the roadmap.

#### GAP-S-02 · No room capacity / quota limits — UNLISTED
There is no `maxPeers` option on `SignalingServer` or per-room. A room can grow unbounded.  
**Not mentioned in any phase.**

#### GAP-S-03 · No room password / invite-code support — UNLISTED
The auth hook enables JWT-based auth but there is no built-in room-password or invite-code pattern.  
Developers must implement this entirely themselves.  
**Not mentioned in any phase.**

#### GAP-S-04 · No `room.enableMedia()` hook — Cross-phase gap
`HighLevelPlan.md` shows `await room.enableMedia(media)` as the wiring point between signaling and media.  
This method does not exist on the signaling `Room` class.  
**Not mentioned in any phase as a concrete task.**  
This is a critical API gap between Phase 1 and Phase 2.

---

### `@rtcforge/sdk`

#### GAP-SDK-01 · No `room.publishCamera()` / `room.on('trackAdded', ...)` — Cross-phase gap
`HighLevelPlan.md` shows the SDK as the entry point for media:
```js
await room.publishCamera()
room.on('trackAdded', (track, peer) => { /* render video */ })
```
Neither method nor event exists on the SDK `Room` class. Media and signaling are completely disconnected at the SDK level.  
**Not listed as a task in Phase 2 or any phase.**

#### GAP-SDK-02 · No `room.whiteboard` accessor — Cross-phase gap
`HighLevelPlan.md` shows `room.whiteboard.on('event', ...)` and `room.whiteboard.emit(...)`.  
The SDK `Room` class only exposes `room.chat`. No `whiteboard` property exists or is planned as an SDK task in Phase 7.  
**Not listed in Phase 7.**

#### GAP-SDK-03 · No automatic token refresh — UNLISTED
The SDK accepts a token at construction time but has no mechanism to refresh it before it expires.  
Long-lived sessions (e.g., a 2-hour meeting) will silently fail on reconnect if the token has expired.  
**Not mentioned in any phase.**

#### GAP-SDK-04 · No offline message queue persistence — UNLISTED
When the WebSocket disconnects, the SDK's in-memory message queue is lost on page reload.  
There is no `localStorage` or `IndexedDB` persistence option.  
**Not mentioned in any phase.**

#### GAP-SDK-05 · `peers` property returns `Set<string>` with no metadata — UNLISTED
`room.peers` is a `Set<string>` (peer IDs only). There is no way to get role, join time, or any metadata for a peer from the SDK.  
**Not mentioned in any phase.**

---

## Phase 2 — Media Package Gaps

#### GAP-M-01 · Mesh only, not SFU — Architectural gap
The plan states mediasoup SFU as the core architecture for group calls. The actual implementation is a P2P mesh using the browser's `RTCPeerConnection`.  
- Mesh does not scale beyond ~4 peers (bandwidth multiplies per peer)
- No worker pool, no load balancing, no mediasoup dependency
- Phase 6 mentions "SFU for streaming" but **SFU for group calls is not listed anywhere as a Phase 5 or 6 task**

**Impact:** The `@rtcforge/media` package cannot be used for real group video calls in production. This is the largest architectural gap in the project.  
**Not covered by any phase as a dedicated task.**

#### GAP-M-02 · No TURN server wiring — Within-phase gap
`HighLevelPlan.md` shows:
```js
const media = new MediaService({ turn: { urls: '...', username: '...', credential: '...' } })
```
`CallOptions` has no `turn` field. ICE servers are hardcoded to `[{ urls: 'stun:stun.l.google.com:19302' }]` in `PeerConnection.ts`.  
**Promised in Phase 2, not delivered.**

#### GAP-M-03 · No `peer.subscribeAll()` method — Within-phase gap
`HighLevelPlan.md` shows `await peer.subscribeAll()` as the primary API for a peer to receive all room tracks.  
This method does not exist anywhere in the codebase.  
**Promised in Phase 2, not delivered.**

#### GAP-M-04 · No codec selection or bitrate control — UNLISTED
No `codec`, `maxBitrate`, or `simulcast` options on `CallOptions` or `PeerConnection`.  
**Not mentioned in any phase.**

#### GAP-M-05 · No `peer.on('trackPublished', ...)` — Within-phase gap
The plan shows `peer.on('trackPublished', (track) => {...})` on the server-side peer.  
The signaling `Peer` class has no media-related events.  
**Promised in Phase 2, not delivered.**

#### GAP-M-06 · Media package has only 5 tests — Coverage gap
`packages/media/tests/` has one file (`MediaManager.test.ts`) with 5 tests covering only `getUserMedia` and `getDisplayMedia`.  
`Call.ts` (154 lines, the core P2P logic) has zero tests.  
`PeerConnection.ts` (99 lines, WebRTC state machine) has zero tests.  
**Not mentioned in any phase.**

---

## Phase 3 — Reliability & Observability Gaps

#### GAP-R-01 · No health check utilities — Within-phase gap
Phase 3 listed "Health check utilities" as a deliverable. Nothing was built.  
`SignalingServer.getStats()` exists but there is no HTTP `/health` endpoint or heartbeat monitor.  
**Promised in Phase 3, not delivered.**

#### GAP-R-02 · Logger interface is a noop, no real integration — Within-phase gap
All packages accept `logger?: Logger` and default to `noopLogger`. There is no structured logger implementation (e.g., pino, winston adapter). Developers must wire their own.  
This is a reasonable design but the plan implied RTCForge would provide a default structured logger.  
**Partially delivered.**

---

## Phase 4 — Chat & Presence Gaps

#### GAP-C-01 · `PresenceService` does not broadcast to peers — Cross-phase gap
The plan shows `presence.on('online', peer => ...)` as a room-wide event that all peers receive.  
The actual `PresenceService` only emits events server-side (Node.js EventEmitter). Other connected clients are **not notified** when a peer comes online or goes offline via the WebSocket.  
There is no `PresenceOnline` / `PresenceOffline` message type in the protocol.  
**Significant gap: clients cannot show a "X just joined" / "X went offline" toast.**

#### GAP-C-02 · No file attachment upload/download — UNLISTED
`ChatMessage` schema and `MediaAttachment` type exist, including fields like `url`, `mimeType`, `size`, `filename`.  
There is no mechanism to actually upload a file (no presigned URL generation, no multipart handling, no storage config).  
The attachment field is schema-only with no end-to-end path.  
**Not mentioned in any phase.**

#### GAP-C-03 · No persistent message store beyond in-memory — UNLISTED
`InMemoryMessageStore` is the only implementation of `MessageStore`. All chat history is lost on server restart.  
The plan mentions the `MessageStore` interface is injectable, but no Redis or database adapter is provided.  
**Not mentioned in any phase.**

#### GAP-C-04 · `presence.getOnline()` returns peer IDs, plan shows peer objects — Cross-phase gap
The plan shows `presence.getOnline()` returning peer objects. The actual implementation returns `string[]` (peer IDs only).  
Minor but inconsistent with the documented API.

---

## Unlisted Gaps — Not Covered by Any Phase

These are gaps found during audit that do not appear in Phases 1–9 of `HighLevelPlan.md`. Each needs to be explicitly added to the roadmap or acknowledged as a known limitation.

### UG-01 · Zero documentation
`docs/` directory exists but is completely empty. There is no:
- Getting started guide
- API reference
- Architecture diagram
- Package integration guide
- Migration guide

Phase 8 mentions "Documentation site" but no intermediate developer docs are planned for earlier phases.

### UG-02 · No integration or E2E tests
All 118 tests are unit tests using mocked WebSocket connections. There are no:
- Integration tests (real WebSocket server + real client)
- E2E tests (browser-side behavior)
- Multi-peer scenario tests

The media package's core (`Call.ts`, `PeerConnection.ts`) has zero test coverage.

### UG-03 · `room.enableMedia(media)` API not designed
The central wiring method shown in `HighLevelPlan.md` (`room.enableMedia(media)`) does not exist and is not planned as a task in any phase. This is the missing bridge between `@rtcforge/signaling` and `@rtcforge/media`.

### UG-04 · SDK has no media or whiteboard surface
The SDK `Room` class exposes only `room.chat`. The planned API shows `room.publishCamera()`, `room.on('trackAdded', ...)`, and `room.whiteboard.*`. These need to be added to the SDK in Phase 2 and Phase 7 task lists respectively.

### UG-05 · No npm publishing configuration
No `publishConfig`, no `.npmignore`, no `prepublish` script, no `changeset` or `release-it` setup. Packages cannot be published to npm as-is.  
Phase 1 stated "Published to npm" as a deliverable.

### UG-06 · No `CONTRIBUTING.md` or `CHANGELOG.md`
`HighLevelPlan.md` references `CONTRIBUTING.md` but it does not exist.

### UG-07 · Peer role enforcement is incomplete
`PeerRole` (host/participant/viewer) exists in the auth payload and `sendRoles` option in `ChatService`. However:
- No role-based media publish/subscribe restrictions
- No role-change event or runtime role promotion
- No host-transfer mechanism (if host leaves, no new host is assigned)

### UG-08 · SFU architecture is deferred with no explicit phase
The plan calls mediasoup SFU the "core architecture" for group calls. The current mesh implementation in `@rtcforge/media` is explicitly called a Phase 2 placeholder in memory notes but is **not listed as a Phase 5 or 6 task** to replace. Phase 6 mentions SFU only in the context of streaming. There is no "replace mesh with SFU" task anywhere in the roadmap.

---

## Gaps by Priority

### P0 — Blocks real-world usage today

| ID | Gap | Why Critical |
|----|-----|--------------|
| UG-03 | `room.enableMedia(media)` missing | No way to wire signaling + media as documented |
| UG-04 | SDK has no media/whiteboard surface | SDK is the client API — without this, clients can't use media |
| GAP-M-01 | Mesh only, not SFU | Mesh breaks at >4 peers; can't ship group calls |
| GAP-M-02 | No TURN config | Calls fail behind symmetric NAT (most corporate networks) |
| GAP-C-01 | Presence not broadcast to clients | Clients can't show who's online in real time |

### P1 — Significant but workaroundable

| ID | Gap | Impact |
|----|-----|--------|
| UG-05 | No npm publishing | Can't install from npm; only monorepo local |
| UG-01 | No docs | Hard to onboard new developers |
| GAP-S-01 | No peer kick/ban | Can't moderate rooms |
| GAP-SDK-03 | No token refresh | Long sessions fail silently |
| GAP-C-02 | No file attachment pipeline | Chat attachments are schema-only |
| GAP-C-03 | No persistent message store | All history lost on restart |
| UG-09 | SFU not in roadmap | Core architectural decision is undecided |

### P2 — Quality / completeness

| ID | Gap | Impact |
|----|-----|--------|
| UG-02 | No integration tests | Regressions won't be caught |
| GAP-M-06 | Media has 5 tests | Core WebRTC logic untested |
| GAP-M-03 | No `peer.subscribeAll()` | Planned Phase 2 API missing |
| GAP-M-05 | No `trackPublished` event | Planned Phase 2 API missing |
| GAP-S-02 | No room capacity limits | Rooms can grow unbounded |
| UG-06 | No CI/CD | No automated quality gate |
| GAP-R-01 | No health check endpoint | Can't monitor deployed server |

---

## Recommended Roadmap Additions

The following items need to be **added to HighLevelPlan.md** as they are not currently in any phase:

```
Phase 2 (add to existing):
  - Add TURN server config to CallOptions / PeerConnection
  - Implement peer.subscribeAll() and peer.on('trackPublished', ...)
  - Add SDK room.publishCamera() and room.on('trackAdded', ...)
  - Clarify: mesh is Phase 2 temporary; SFU migration is Phase 6

Phase 4 (add to existing):
  - Broadcast PresenceOnline / PresenceOffline messages to all room peers
  - Add file attachment upload pipeline (presigned URL pattern)
  - Provide at least one persistent MessageStore adapter (e.g., Redis)

New Phase — "Foundation & DX" (insert between Phase 4 and Phase 5):
  - room.enableMedia(media) API on signaling Room
  - SDK room.whiteboard accessor stub (Phase 7 fills implementation)
  - Integration test harness (real WS server + client in Node)
  - npm publish configuration (changesets or release-it)
  - CONTRIBUTING.md, CHANGELOG.md
  - docs/GETTING_STARTED.md (basic signaling + chat walkthrough)

Phase 8 (add to existing):
  - Peer kick/ban API on Room
  - Room capacity / maxPeers option
  - Room password / invite-code support
  - Peer role promotion API (host transfer)
  - Automatic token refresh hook in SDK

Phase 9 or new Phase:
  - Replace @rtcforge/media mesh with mediasoup SFU (explicit task)
  - Worker pool management
  - Producer/Consumer lifecycle
  - Bitrate control and simulcast
```

---

## What Is Solid

To be clear about what is complete and production-quality within its scope:

| Area | Assessment |
|------|-----------|
| WebSocket signaling protocol | Well-designed. Zod validation, auth hook, heartbeat, graceful shutdown |
| SDK reconnection | Solid exponential backoff with message queue |
| Chat layer | Feature-complete for in-session messaging. DM/group/broadcast routing, history, reactions, receipts |
| TypeScript types | Strong throughout. Zod schemas at protocol boundaries |
| Test suite (118 tests) | Good unit coverage for signaling, SDK, chat |
| Example apps (2 of 4) | video-call-app and chat-app are working, well-structured demos |
| Monorepo tooling | tsup, vitest, eslint, prettier — all correctly configured |
