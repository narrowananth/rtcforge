# video-call-app

1:1 and group video call example using `@rtcforge/sdk`, `@rtcforge/signaling`, and `@rtcforge/media`.

Features: camera/mic capture, peer-to-peer video via WebRTC mesh, remote track display, peer join/leave events.

## Prerequisites

| Dependency | Version  |
| ---------- | -------- |
| Node.js    | `>= 18`  |
| npm        | `>= 9`   |

Run `npm install` from the **monorepo root** before starting.

> **Browser requirement:** a Chromium or Firefox browser with camera/microphone access. For local testing both tabs can share the same physical camera.

## How to run

You need two terminals.

**Terminal 1 — signaling server** (WebSocket on port 3003):

```bash
cd examples/video-call-app
npm run server
# Signaling server running on ws://localhost:3003
```

**Terminal 2 — browser dev server** (Vite on port 5175):

```bash
cd examples/video-call-app
npm run dev
# → http://localhost:5175
```

Open **two browser tabs** at `http://localhost:5175`.

In each tab:
1. Enter a unique **Peer ID** (e.g. `alice`, `bob`).
2. Enter the same **Room ID** (e.g. `room1`).
3. Click **Join Room** — the browser will ask for camera and microphone permission. Allow it.

Each tab streams video to the other. Remote video appears automatically once both peers have joined. Closing a tab ends that peer's stream.

## Scripts

| Script           | Description                                     |
| ---------------- | ----------------------------------------------- |
| `npm run server` | Start the signaling server (`tsx`)              |
| `npm run dev`    | Start the Vite dev server with hot reload       |
| `npm run build`  | Build the frontend to `dist/`                   |

## Ports

| Service            | Address                    |
| ------------------ | -------------------------- |
| Signaling server   | `ws://localhost:3003`      |
| Browser dev server | `http://localhost:5175`    |

## Architecture

```
Browser tab A ──┐
                ├── WebSocket ──► signaling server (server.ts :3003)
Browser tab B ──┘
      │                            relays WebRTC SDP + ICE signals
      └── RTCPeerConnection (direct P2P media, not through server)
```

The signaling server relays SDP offers/answers and ICE candidates between peers. Actual audio/video travels directly peer-to-peer via `RTCPeerConnection` (no media goes through the server). The `@rtcforge/media` `Call` class manages connection negotiation and the perfect-negotiation collision-avoidance pattern.
