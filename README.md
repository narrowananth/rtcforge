# RTCForge

Open-source npm library for building real-time communication systems on top of WebRTC.

---

## Prerequisites

| Dependency | Version |
| ---------- | ------- |
| Node.js | `>= 18` |
| npm | `>= 9` |

---

## Setup

```bash
git clone https://github.com/your-org/rtcforge.git
cd rtcforge
npm install
```

`npm install` will also initialize Husky git hooks automatically.

---

## Managing Dependencies

All dependencies for every package are installed from the root with a single command:

```bash
npm install
```

npm workspaces hoists all dependencies into the root `node_modules/`. You never need to run `npm install` inside individual packages.

**Add a dependency to a specific package:**

```bash
# from the root (recommended)
npm install ws --workspace packages/signaling

# add a dev dependency
npm install @types/ws --save-dev --workspace packages/signaling
```

**Add a shared dev dependency to the root (available to all packages):**

```bash
npm install some-tool --save-dev
```

**Remove a dependency from a specific package:**

```bash
npm uninstall ws --workspace packages/signaling
```

---

## Commands

| Command | Description |
| ------- | ----------- |
| `npm install` | Install all dependencies across every package |
| `npm run build` | Build all packages (tsup → CJS + ESM + types) |
| `npm run dev` | Watch mode — rebuild packages on file change |
| `npm run typecheck` | Type-check all packages without emitting |
| `npm run check` | Lint and format check (Biome) |
| `npm run check:fix` | Auto-fix lint and format issues |
| `npm run clean` | Remove all `dist/` output directories |
| `npm test` | Run tests (Vitest) |

All commands run across the full monorepo. To target a single package:

```bash
cd packages/signaling
npm run build
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

| Package | Description |
| ------- | ----------- |
| `@rtcforge/signaling` | `SignalingServer`, `Room`, `Peer` — WebSocket signaling and session lifecycle |
| `@rtcforge/sdk` | Browser + Node.js client SDK |
| `@rtcforge/media` | `MediaService` — mediasoup SFU, Worker Pool, Producer, Consumer |
| `@rtcforge/chat` | `ChatService`, `PresenceService`, typing indicators |
| `@rtcforge/recording` | `RecordingService` — per-room recording, S3/MinIO upload |
| `@rtcforge/streaming` | `StreamingService` — HLS and RTMP egress |
| `@rtcforge/whiteboard` | `WhiteboardService` — state sync, CRDT-compatible hooks |

---

## Tooling

| Tool | Purpose |
| ---- | ------- |
| TypeScript 5 | Language |
| tsup | Builds each package to CJS + ESM + `.d.ts` |
| Vitest | Tests |
| Biome | Lint + format (replaces ESLint + Prettier) |
| Husky + lint-staged | Pre-commit: runs Biome on staged files |

---

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before submitting a PR.

---

## License

[MIT](LICENSE)
