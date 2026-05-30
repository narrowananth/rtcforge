# whiteboard-app

Collaborative whiteboard example using `@rtcforge/sdk`, `@rtcforge/signaling`, and `@rtcforge/whiteboard`.

Features: real-time freehand drawing, color/brush-size picker, erase mode, clear canvas, remote cursor tracking, state sync for late joiners, touch support.

## Prerequisites

| Dependency | Version  |
| ---------- | -------- |
| Node.js    | `>= 18`  |
| npm        | `>= 9`   |

Run `npm install` from the **monorepo root** before starting.

## How to run

You need two terminals.

**Terminal 1 — signaling server** (WebSocket on port 3005):

```bash
cd examples/whiteboard-app
npm run server
# Whiteboard server running on ws://localhost:3005
```

**Terminal 2 — browser dev server** (Vite on port 5177):

```bash
cd examples/whiteboard-app
npm run dev
# → http://localhost:5177
```

Open **two or more browser tabs** at `http://localhost:5177`.

In each tab:
1. Enter a unique **Peer ID** (e.g. `alice`, `bob`).
2. Enter the same **Room ID** (e.g. `board1`).
3. Click **Join**.

All strokes appear instantly in every tab. A tab that joins late receives a full state sync of existing strokes. Click **Clear** to wipe the canvas for everyone.

**Toolbar controls:**
- **Color picker + Brush size** — adjusts stroke color and width
- **Erase** — toggles erase mode; eraser width is 4× the brush size (draws white strokes via `WhiteboardEventType.Erase`)
- **Clear** — broadcasts `WhiteboardEventType.Clear`, wipes all peers' canvases and server stroke history
- **Remote cursors** — each peer's pointer position is broadcast via `WhiteboardEventType.Cursor` and rendered as a floating dot on the canvas

## Scripts

| Script           | Description                                       |
| ---------------- | ------------------------------------------------- |
| `npm run server` | Start the signaling + whiteboard server (`tsx`)   |
| `npm run dev`    | Start the Vite dev server with hot reload         |
| `npm run build`  | Build the frontend to `dist/`                     |

## Ports

| Service            | Address                    |
| ------------------ | -------------------------- |
| Signaling server   | `ws://localhost:3005`      |
| Browser dev server | `http://localhost:5177`    |

## Architecture

```
Browser tab A ──┐
                ├── WebSocket ──► signaling server (server.ts :3005)
Browser tab B ──┘                └── WhiteboardService
                                      • validates + relays draw events
                                      • maintains stroke history
                                      • sends full state to late joiners
```

The signaling server uses `@rtcforge/whiteboard`'s `WhiteboardService` to relay draw/clear events and maintain a stroke list for state sync. When a new peer joins, `onPeerJoined` sends them the accumulated stroke history. The browser client uses `@rtcforge/sdk`'s `WhiteboardRoom` to send and receive whiteboard events.
