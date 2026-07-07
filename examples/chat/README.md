# Chat + presence example

Room-scoped messaging and presence over the RTCForge signaling channel. **No media, no mediasoup** — just `rtcforge/server` + `rtcforge/client`.

## Run

```bash
npm install
node server.mjs        # ws://localhost:3001
```

Open `client.html` in **two browser tabs**. Each tab is a random user in room `general`. Type in one — it appears in both.

## How it works

- **Server** (`server.mjs`) — `createSignalingServer` with an auth hook. The signaling channel is an authenticated, room-scoped message bus; chat is just messages you relay.
- **Client** (`client.html`) — `createClient(...).joinRoom("general")`, then:
  - `room.broadcast("chat", { text })` fans a message out to the room.
  - `room.on("broadcast", (from, channel, data) => …)` receives them; filter by `channel`.
  - `RoomEvent.PeerJoined` / `PeerLeft` drive presence.

Same package set powers collaborative apps (whiteboard, cursors, live docs) — see [`docs/BUILDING_APPS.md`](../../docs/BUILDING_APPS.md).
