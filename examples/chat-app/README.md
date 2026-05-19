# chat-app

Multi-user chat example using `@rtcforge/sdk`, `@rtcforge/signaling`, and `@rtcforge/chat`.

Features: broadcast messages, direct messages, group messages, typing indicators, message edit/delete, emoji reactions, and read receipts.

## Prerequisites

| Dependency | Version  |
| ---------- | -------- |
| Node.js    | `>= 18`  |
| npm        | `>= 9`   |

Run `npm install` from the **monorepo root** before starting — this installs all workspace dependencies including this app's.

## How to run

You need two terminals.

**Terminal 1 — signaling server** (WebSocket on port 3001):

```bash
cd examples/chat-app
npm run server
# Signaling server running on ws://localhost:3001
```

**Terminal 2 — browser dev server** (Vite on port 5173):

```bash
cd examples/chat-app
npm run dev
# → http://localhost:5173
```

Open **two or more browser tabs** at `http://localhost:5173`.

In each tab:
1. Enter a unique **Peer ID** (e.g. `alice`, `bob`).
2. Enter the same **Room ID** (e.g. `main`).
3. Click **Join**.

Peers see each other join in real time. Type in the message box and press **Send** (or `Enter`) to chat. Additional features (DM, reactions, edit, delete) appear in the UI once two or more peers are in the room.

## Scripts

| Script           | Description                                    |
| ---------------- | ---------------------------------------------- |
| `npm run server` | Start the signaling + chat server (`tsx`)      |
| `npm run dev`    | Start the Vite dev server with hot reload      |
| `npm run build`  | Build the frontend to `dist/`                  |

## Ports

| Service           | Address                    |
| ----------------- | -------------------------- |
| Signaling server  | `ws://localhost:3001`      |
| Browser dev server| `http://localhost:5173`    |

## Architecture

```
Browser tab A ──┐
                ├── WebSocket ──► signaling server (server.ts :3001)
Browser tab B ──┘                └── ChatService + PresenceService
```

The signaling server uses `@rtcforge/chat`'s `ChatService` to broadcast messages, track typing, and handle edits/deletes. The browser client uses `@rtcforge/sdk`'s `RTCForgeClient` and `ChatRoom` to send and receive chat events.
