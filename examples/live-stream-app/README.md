# live-stream-app

Live streaming example using `@rtcforge/sdk`, `@rtcforge/signaling`, `@rtcforge/media`, and `@rtcforge/streaming`.

Features: role-based rooms (host / viewer), token-based auth, host streams camera/mic to all viewers via WebRTC mesh, viewer count tracking, late-joiner support.

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
| `npm run server` | Start the signaling + streaming server (`tsx`)  |
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
Viewer browser(s) ─┘                └── StreamingService
      │                                  tracks host/viewer roles,
      └── RTCPeerConnection              enforces maxViewers cap
          (direct P2P media)
```

The signaling server uses `@rtcforge/streaming`'s `StreamingService` to manage the session. Each room has exactly one host; viewers join and receive the host's stream via WebRTC peer connections. Authentication uses a base64 token that carries `{ roomId, peerId, role }`.
