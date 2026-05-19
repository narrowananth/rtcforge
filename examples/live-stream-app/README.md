# live-stream-app

> **Status: not yet implemented.** This example is planned for a future phase once `@rtcforge/streaming` is available.

WebRTC → HLS broadcast example using `@rtcforge/sdk`, `@rtcforge/signaling`, `@rtcforge/media`, and `@rtcforge/streaming`.

## Planned features

- One broadcaster streams camera/mic via WebRTC to the server.
- Server re-encodes and packages the stream as HLS.
- Any number of viewers watch the live HLS feed in a standard `<video>` element.
- Low-latency LL-HLS support for sub-2-second glass-to-glass delay.

## Prerequisites (when implemented)

| Dependency | Version  |
| ---------- | -------- |
| Node.js    | `>= 18`  |
| npm        | `>= 9`   |
| FFmpeg     | `>= 6`   |

## How to run (when implemented)

You will need two terminals.

**Terminal 1 — streaming server** (on port 3002):

```bash
cd examples/live-stream-app
npm run dev
# Streaming server running on http://localhost:3002
```

**Terminal 2 — browser dev server** (Vite on port 5174):

```bash
cd examples/live-stream-app
npm run dev:client
# → http://localhost:5174
```

**Browser — broadcaster:**

Open `http://localhost:5174/broadcast`, allow camera access, and click **Go Live**.

**Browser — viewer:**

Open `http://localhost:5174` in any tab to watch the live stream.

## Scripts

| Script       | Description                                      |
| ------------ | ------------------------------------------------ |
| `npm run dev`| Start the server in watch mode (`ts-node`)       |
| `npm start`  | Start the compiled server (`node dist/index.js`) |

## Ports

| Service            | Address                    |
| ------------------ | -------------------------- |
| Streaming server   | `http://localhost:3002`    |
| Browser dev server | `http://localhost:5174`    |
