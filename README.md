# RTCForge

Open-source npm library for building real-time communication systems on top of WebRTC.

Composable packages, pick the layers you need: WebSocket **signaling**, a browser/Node **client SDK**, a **media plane** (P2P mesh `Call` + mediasoup **SFU**), and **shared-nothing multi-node scale-out** (consistent-hash routing + gossip membership — **no Redis/etcd**). It stops at the transport boundary — chat, presence, recording, and whiteboard are built in *your* application layer on the primitives it exposes. See `ARCHITECTURE.md` and `docs/SCALING.md`.

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
 ├── packages/                  # CORE LAYER (published to npm)
 │    ├── core/            # rtcforge-core        — shared primitives + scale primitives (zero deps)
 │    ├── signaling/       # rtcforge-signaling   — WebSocket signaling server, RoomRouter cluster
 │    ├── sdk/             # rtcforge-sdk         — browser + Node.js client
 │    ├── media/           # rtcforge-media       — P2P mesh Call + mediasoup SFU
 │    ├── sfu/             # rtcforge-sfu         — multi-node cluster, cascade fan-out tree
 │    └── adapter-udp/     # rtcforge-adapter-udp — UdpGossipTransport (gossip network wire)
 │
 ├── examples/             # APPLICATION LAYER reference apps (not published)
 │    ├── video-call-app/   # 1:1 and group video call (signaling + sdk)
 │    ├── chat-app/         # Multi-user chat + presence (sdk broadcast)
 │    ├── live-stream-app/  # Host/viewer streaming + 1M-viewer cascade tree (sfu)
 │    ├── sfu-app/          # SFU cluster routing + media plane (sfu + media)
 │    └── whiteboard-app/   # Collaborative whiteboard (sdk DataChannel)
 │
 ├── cli/                  # rtcforge-cli
 ├── docs/SCALING.md       # Scaling model + the 1M-user analysis
 ├── ARCHITECTURE.md       # Architecture & integration guide
 ├── biome.json            # Lint + format config (Biome)
 ├── tsconfig.base.json    # Shared TypeScript config
 └── tsconfig.json         # Root typecheck (references all packages)
```

> RTCForge is a **two-layer** library: the published `packages/` are the **core
> transport layer**; features like chat, presence, and whiteboard live in **your
> application layer**, built on the transport primitives (the `chat-app` and
> `whiteboard-app` examples do exactly this on top of `sdk` + `signaling`).
> See `ARCHITECTURE.md` and `docs/SCALING.md`.

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
| `rtcforge-core` | Shared primitives — `EventEmitter`, `Logger`, `MetricsCollector` — **plus shared-nothing scale primitives**: `HashRing`, `GossipMembership`, `Membership`, `Clock`, `StateStore`, `MessageBus`, `Lock`, `IdGenerator`. Zero runtime dependencies. |
| `rtcforge-signaling` | `SignalingServer`, `Room`, `Peer` — WebSocket signaling, auth hook, rate-limit, heartbeat, and `RoomRouter` cluster sharding |
| `rtcforge-sdk` | `RTCForgeClient`, `Room` — browser + Node.js client; reconnect, send queue, injectable `Transport` |
| `rtcforge-media` | `Call` (P2P mesh, perfect-negotiation) + `MediaService`/`MediaRouter` (mediasoup SFU: `WorkerPool`, `Producer`, `Consumer`) |
| `rtcforge-sfu` | `SfuCluster`, `CascadingRouter`, `HashRingStrategy`, `CascadeTree`/`CascadeBridge` — multi-node routing, cascade fan-out, health, bandwidth estimation |
| `rtcforge-adapter-udp` | `UdpGossipTransport` — the real network wire for `rtcforge-core` gossip (the only socket code) |

---

## Install & use

Packages are on the public npm registry, unscoped, prefixed `rtcforge-`. Install only the layer you need (deps pull in `rtcforge-core` transitively):

```bash
npm install rtcforge-sdk            # client
npm install rtcforge-signaling      # backend
```

```ts
import { RTCForgeClient } from "rtcforge-sdk";
const client = new RTCForgeClient({ serverUrl: "wss://your-signaling-host" });
const room = await client.joinRoom("my-room");
```

**Full install table, server example, publishing, and local testing → [`docs/PUBLISHING.md`](docs/PUBLISHING.md).**

---

### Running the example apps

Each example has its own README with full instructions. Port assignments at a glance:

| App               | Server port               | Browser dev server         |
| ----------------- | ------------------------- | -------------------------- |
| `chat-app`        | `3002`                    | `http://localhost:5174`    |
| `video-call-app`  | `3003`                    | `http://localhost:5175`    |
| `live-stream-app` | `3004`                    | `http://localhost:5176`    |
| `whiteboard-app`  | `3005`                    | `http://localhost:5177`    |
| `sfu-app`         | `3006`                    | `http://localhost:5178`    |

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
