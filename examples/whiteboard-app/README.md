# whiteboard-app

> **Status: not yet implemented.** This example is planned for a future phase once `@rtcforge/whiteboard` is available.

Collaborative whiteboard example using `@rtcforge/sdk`, `@rtcforge/signaling`, and `@rtcforge/whiteboard`.

## Planned features

- Multiple users draw on a shared canvas in real time.
- State is synced via a CRDT-compatible whiteboard service — no conflicts when users draw simultaneously.
- Late joiners receive the full canvas history on connect.
- Supports shapes, freehand drawing, text, and undo/redo.

## Prerequisites (when implemented)

| Dependency | Version  |
| ---------- | -------- |
| Node.js    | `>= 18`  |
| npm        | `>= 9`   |

## How to run (when implemented)

You will need two terminals.

**Terminal 1 — signaling + whiteboard server** (WebSocket on port 3004):

```bash
cd examples/whiteboard-app
npm run dev
# Server running on ws://localhost:3004
```

**Terminal 2 — browser dev server** (Vite on port 5176):

```bash
cd examples/whiteboard-app
npm run dev:client
# → http://localhost:5176
```

Open **two or more browser tabs** at `http://localhost:5176`, enter a room ID, and start drawing. Every stroke appears instantly in all other tabs.

## Scripts

| Script       | Description                                      |
| ------------ | ------------------------------------------------ |
| `npm run dev`| Start the server in watch mode (`ts-node`)       |
| `npm start`  | Start the compiled server (`node dist/index.js`) |

## Ports

| Service            | Address                    |
| ------------------ | -------------------------- |
| Signaling server   | `ws://localhost:3004`      |
| Browser dev server | `http://localhost:5176`    |
