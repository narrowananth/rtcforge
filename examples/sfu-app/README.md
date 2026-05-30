# sfu-app

SFU (Selective Forwarding Unit) routing demo using `@rtcforge/sdk`, `@rtcforge/signaling`, `@rtcforge/media`, and `@rtcforge/sfu`.

Features: multi-peer video via WebRTC mesh, server-side SFU cluster simulation, cascading router, producer/consumer model, node failure/recovery simulation, live load reporting.

## Prerequisites

| Dependency | Version  |
| ---------- | -------- |
| Node.js    | `>= 18`  |
| npm        | `>= 9`   |

Run `npm install` from the **monorepo root** before starting.

> **Browser requirement:** a Chromium or Firefox browser with camera/microphone access.

## How to run

You need two terminals.

**Terminal 1 — signaling server** (WebSocket on port 3006):

```bash
cd examples/sfu-app
npm run server
# SFU app server running on ws://localhost:3006
```

**Terminal 2 — browser dev server** (Vite on port 5178):

```bash
cd examples/sfu-app
npm run dev
# → http://localhost:5178
```

Open **two or more browser tabs** at `http://localhost:5178`.

In each tab:
1. Enter a unique **Peer ID** (e.g. `alice`, `bob`).
2. Enter the same **Room ID** (e.g. `room1`).
3. Click **Join** — allow camera/mic when prompted.

Each peer's video appears in all other tabs. Use **Start/Stop Camera** to toggle the local stream. Watch the server terminal to see SFU node assignments, cascade routes, and load changes. After 45 seconds the server simulates `sfu-us-east-1` failure; after 75 seconds it recovers.

## Scripts

| Script           | Description                                     |
| ---------------- | ----------------------------------------------- |
| `npm run server` | Start the signaling + SFU server (`tsx`)        |
| `npm run dev`    | Start the Vite dev server with hot reload       |
| `npm run build`  | Build the frontend to `dist/`                   |

## Ports

| Service            | Address                    |
| ------------------ | -------------------------- |
| Signaling server   | `ws://localhost:3006`      |
| Browser dev server | `http://localhost:5178`    |

## Architecture

```
Browser tab A ──┐
                ├── WebSocket ──► signaling server (server.ts :3006)
Browser tab B ──┘                ├── SfuCluster  (3 simulated nodes)
      │                          ├── CascadingRouter
      └── RTCPeerConnection      └── MediaService
          (direct P2P media)          └── MediaRouter (per room)
                                           ├── Producer (per peer)
                                           └── Consumer (cross-subscriptions)
```

The server maintains a `SfuCluster` with three simulated SFU nodes (`us-east`, `eu-west`, `ap-south`). The `CascadingRouter` assigns each room to the least-loaded node and creates cascade routes when needed. The `MediaService` attaches a `MediaRouter` to each room, creating producers and consumers as peers join. Actual media travels peer-to-peer via `RTCPeerConnection`; the SFU layer is a routing abstraction demonstrating the `@rtcforge/sfu` API.
