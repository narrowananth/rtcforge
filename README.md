# RTCForge

Open-source npm library for building real-time communication systems on top of WebRTC.

---

## Prerequisites

| Dependency | Version |
| ---------- | ------- |
| Node.js    | `>= 18` |
| npm        | `>= 9`  |

---

## Setup

```bash
git clone https://github.com/your-org/rtcforge.git
cd rtcforge
npm install
```

`npm install` installs all workspace dependencies and initialises Husky git hooks automatically.

---

## Commands

Run from the monorepo root — they apply to all packages:

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `npm install`      | Install all dependencies across every package    |
| `npm test`         | Run unit tests (Vitest)                          |
| `npm run build`    | Build all packages (tsup → CJS + ESM + `.d.ts`) |
| `npm run dev`      | Watch mode — rebuild packages on file change     |
| `npm run typecheck`| Type-check all packages without emitting         |
| `npm run check`    | Lint and format check (Biome)                    |
| `npm run check:fix`| Auto-fix lint and format issues                  |
| `npm run clean`    | Remove all `dist/` output directories            |

To target a single package:

```bash
npm run build --workspace=packages/signaling
npm test --workspace=packages/sdk
```

---

## Project Structure

```
rtcforge/
 ├── packages/
 │    ├── signaling/       # @rtcforge/signaling
 │    ├── sdk/             # @rtcforge/sdk
 │    ├── media/           # @rtcforge/media
 │    ├── chat/            # @rtcforge/chat
 │    ├── recording/       # @rtcforge/recording
 │    ├── streaming/       # @rtcforge/streaming
 │    └── whiteboard/      # @rtcforge/whiteboard
 │
 ├── examples/             # Sample apps (not published to npm)
 │    ├── video-call-app/
 │    ├── live-stream-app/
 │    └── whiteboard-app/
 │
 ├── cli/                  # @rtcforge/cli
 ├── docs/
 ├── biome.json            # Lint + format config (Biome)
 ├── tsconfig.base.json    # Shared TypeScript config
 └── tsconfig.json         # Root typecheck (references all packages)
```

Each package under `packages/` follows the same layout:

```
packages/<name>/
 ├── src/
 │    └── index.ts
 ├── package.json
 └── tsconfig.json
```

---

## Packages

| Package                   Description                                                  |
| ------------------------  ------------------------------------------------------------ |
| `@rtcforge/signaling`    | `SignalingServer`, `Room`, `Peer` — WebSocket signaling and session lifecycle |
| `@rtcforge/sdk`          | `RTCForgeClient`, `Room` — browser + Node.js client SDK      |
| `@rtcforge/media`        | `MediaService` — mediasoup SFU, Worker Pool, Producer, Consumer |
| `@rtcforge/chat`         | `ChatService`, `PresenceService`, typing indicators          |
| `@rtcforge/recording`    | `RecordingService` — per-room recording, S3/MinIO upload     |
| `@rtcforge/streaming`    | `StreamingService` — HLS and RTMP egress                     |
| `@rtcforge/whiteboard`   | `WhiteboardService` — state sync, CRDT-compatible hooks      |

---

### Integration — video-call-app example

The `examples/video-call-app` app lets you test the full signaling + SDK flow in a real browser. It aliases both workspace packages directly to source so no pre-build is needed.

**Terminal 1 — start the signaling server:**

```bash
cd examples/video-call-app
npm run server
# Signaling server running on ws://localhost:3001
```

**Terminal 2 — start the browser dev server:**

```bash
cd examples/video-call-app
npm run dev
# → http://localhost:5173
```

Open **two browser tabs** at `http://localhost:5173`. Enter different peer names (e.g. `alice` and `bob`), the same room ID, and click **Join Room**. Each tab will see the other peer join, and the **Ping / Ping all** buttons send signals between peers — verifying end-to-end relay through the signaling server.

---

## Tooling

| Tool                  | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| TypeScript 5          | Language                                              |
| tsup                  | Builds each package to CJS + ESM + `.d.ts`            |
| Vitest                | Unit tests                                            |
| Biome                 | Lint + format (replaces ESLint + Prettier)            |
| Husky + lint-staged   | Pre-commit: runs Biome on staged files                |

---

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before submitting a PR.

---

## License

[MIT](LICENSE)
