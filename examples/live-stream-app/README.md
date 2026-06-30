# live-stream-app

Live streaming example using `@rtcforge/sdk`, `@rtcforge/signaling`, `@rtcforge/media`, and `@rtcforge/sfu`.

Features: role-based rooms (host / viewer), token-based auth, host streams camera/mic to viewers, viewer count tracking, late-joiner support — **plus a 1-broadcaster → 1M-viewer fan-out tree** (`CascadeTree` + `CascadeBridge`).

## Broadcast fan-out tree (1M viewers, what's new)

A flat SFU can't feed a million viewers — the origin melts. The server now builds a **log-depth cascade tree** over an SFU fleet:

```
        origin SFU (broadcaster ingest)
        ├── relay tier ×8        each pipes to ≤ fanout children
        │     └── edge tier ×1000   each edge serves ≤ viewersPerNode (1000)
        │            └── viewers (×1M)
```

- `planCascadeTree(...)` computes the layout (tier sizing, depth, viewer→edge slots, capacity shortfall) — a **pure function**. The server prints a **1M-viewer plan at startup**: `5 tiers, 1000 edges, served 1000000, unmet 0`.
- `CascadeTree` allocates the plan from the (here synthetic) SFU fleet, emits a `LinkCreated` per parent→child edge, and **rebuilds itself when a node dies** (self-heal).
- `CascadeBridge` turns each link into a real RTP pipe by calling your `SfuMediaInterface.pipeLink(roomId, from, to)` → `MediaRouter.pipeProducerTo` on the SFU host. The demo's adapter just counts pipes; a real host moves the broadcaster's track down the tree.
- When the **host joins**, the server builds the room's tree (sized to 250k viewers for the demo); when the host leaves or the room closes, the tree is torn down.

> The `MAX_VIEWERS` cap (50) limits **real WebSocket viewers** this single process accepts. The cascade tree plans fan-out for far larger audiences — it sizes the relay tree, it does not open those sockets here. See `docs/SCALING.md §4.2`.

## Prerequisites

| Dependency | Version  |
| ---------- | -------- |
| Node.js    | `>= 18`  |
| npm        | `>= 9`   |

Run `npm install` from the **monorepo root** before starting.

> **Browser requirement:** a Chromium or Firefox browser. The host tab needs camera/microphone access.

## How to run

You need two terminals.

**Terminal 1 — signaling server** (WebSocket on port 3004):

```bash
cd examples/live-stream-app
npm run server
# Live stream server running on ws://localhost:3004
```

**Terminal 2 — browser dev server** (Vite on port 5176):

```bash
cd examples/live-stream-app
npm run dev
# → http://localhost:5176
```

Open **two or more browser tabs** at `http://localhost:5176`.

**Host tab:**
1. Enter a **Peer ID** (e.g. `host`).
2. Enter a **Room ID** (e.g. `stream1`).
3. Select **Host** from the role dropdown.
4. Click **Join** — allow camera/mic when prompted.

**Viewer tab(s):**
1. Enter a different **Peer ID** (e.g. `viewer1`).
2. Enter the **same Room ID** as the host.
3. Select **Viewer** from the role dropdown.
4. Click **Join** — the host's stream appears automatically.

## Scripts

| Script           | Description                                     |
| ---------------- | ----------------------------------------------- |
| `npm run server` | Start the signaling + cascade-tree server (`tsx`)  |
| `npm run dev`    | Start the Vite dev server with hot reload       |
| `npm run build`  | Build the frontend to `dist/`                   |

## Ports

| Service            | Address                    |
| ------------------ | -------------------------- |
| Signaling server   | `ws://localhost:3004`      |
| Browser dev server | `http://localhost:5176`    |

## Architecture

```
Host browser ──────┐
                   ├── WebSocket ──► signaling server (server.ts :3004)
Viewer browser(s) ─┘                ├── host/viewer roles, maxViewers cap
      │                             └── CascadeTree + CascadeBridge
      └── RTCPeerConnection              origin → relay tiers → edges → viewers
          (direct P2P media)             pipeLink → MediaRouter.pipeProducerTo
```

The signaling server enforces host/viewer roles and a viewer cap in-line (no separate service). Each room has exactly one host; viewers receive the host's stream. Authentication uses a base64 token carrying `{ roomId, peerId, role }`. For audience scale, the server lays out a `CascadeTree` fan-out tree over an SFU fleet and bridges its links to the media plane via `CascadeBridge` → `pipeProducerTo`. See `docs/SCALING.md` for the full model.
