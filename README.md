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
 │    ├── chat-app/         # Multi-user chat + presence
 │    ├── video-call-app/   # P2P video call
 │    ├── live-stream-app/  # WebRTC → HLS broadcast (planned)
 │    └── whiteboard-app/   # Collaborative whiteboard (planned)
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
| `@rtcforge/recording`    | `RecordingService` — client-side recording via MediaRecorder; per-stream chunked upload hook |
| `@rtcforge/streaming`    | `StreamingService` — WebRTC fan-out streaming; encoder hook interface (HLS/RTMP via custom integration) |
| `@rtcforge/whiteboard`   | `WhiteboardService` — state sync, CRDT-compatible hooks      |

---

### Running the example apps

Each example has its own README with full instructions. Port assignments at a glance:

| App               | Signaling server          | Browser dev server         |
| ----------------- | ------------------------- | -------------------------- |
| `chat-app`        | `ws://localhost:3001`     | `http://localhost:5173`    |
| `live-stream-app` | `http://localhost:3002`   | `http://localhost:5174`    |
| `video-call-app`  | `ws://localhost:3003`     | `http://localhost:5175`    |
| `whiteboard-app`  | `ws://localhost:3004`     | `http://localhost:5176`    |

Every active example follows the same two-terminal pattern:

```bash
# Terminal 1 — signaling server
cd examples/<app-name>
npm run server

# Terminal 2 — browser dev server
cd examples/<app-name>
npm run dev
```

See each app's `README.md` for detailed steps.

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
