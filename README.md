# RTCForge

Open-source npm library for building real-time communication systems on top of WebRTC.

Composable packages, pick the layers you need: WebSocket **signaling**, a browser/Node **client SDK**, a **media plane** (P2P mesh `Call` + mediasoup **SFU**), and **shared-nothing multi-node scale-out** (consistent-hash routing + gossip membership — **no Redis/etcd**). It stops at the transport boundary — chat, presence, recording, and whiteboard are built in *your* application layer on the primitives it exposes. See [`docs/BUILDING_APPS.md`](docs/BUILDING_APPS.md).

**One install for most apps** — the [`rtcforge`](packages/rtcforge) meta-package fronts the whole stack:

```bash
npm i rtcforge                 # frontend + backend (add rtcforge-media for audio/video)
```

```ts
import { createClient } from "rtcforge/client"           // browser
import { createSignalingServer } from "rtcforge/server"   // node
```

Prefer to cherry-pick? Install the individual `rtcforge-*` packages below instead.

---

## Prerequisites

| Dependency | Version |
| ---------- | ------- |
| Node.js    | `>= 18` |
| npm        | `>= 9`  |

---

## Setup

```bash
git clone https://github.com/narrowananth/rtcforge.git
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
| `npm run test:e2e` | Real-browser E2E (needs `npx playwright install chromium`) |
| `npm run changeset`| Record a versioned change (drives per-package CHANGELOGs) |
| `npm run release`  | Build + `changeset publish` (CI runs this on merge) |

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
 │    ├── rtcforge/       # rtcforge             — one-install meta-package (client/server/media/filetransfer)
 │    ├── core/           # rtcforge-core        — shared primitives + scale primitives (zero deps)
 │    ├── signaling/      # rtcforge-signaling   — WebSocket signaling server, RoomRouter cluster
 │    ├── sdk/            # rtcforge-sdk         — browser + Node.js client (+ /filetransfer)
 │    ├── media/          # rtcforge-media       — P2P mesh Call + mediasoup SFU (mediasoup = optional peer)
 │    ├── sfu/            # rtcforge-sfu         — multi-node cluster, cascade fan-out, + /udp gossip wire
 │    └── adapter-udp/    # rtcforge-adapter-udp — DEPRECATED, re-exports rtcforge-sfu/udp
 │
 ├── docs/BUILDING_APPS.md # Implementation guide — which packages per app type + wiring
 ├── e2e/                  # Real-browser (Playwright) end-to-end tests
 ├── .changeset/           # Versioning + CHANGELOG automation
 ├── biome.json            # Lint + format config (Biome)
 ├── tsconfig.base.json    # Shared TypeScript config
 └── tsconfig.json         # Root typecheck (references all packages)
```

> RTCForge is a **two-layer** library: the published `packages/` are the **core
> transport layer**; features like chat, presence, and whiteboard live in **your
> application layer**, built on the transport primitives (`sdk` + `signaling`).
> See [`docs/BUILDING_APPS.md`](docs/BUILDING_APPS.md).

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
| `rtcforge` | **One-install front door.** Re-exports the stack behind subpaths: `rtcforge/client`, `rtcforge/server`, `rtcforge/media`, `rtcforge/filetransfer`. |
| `rtcforge-core` | Shared primitives — `EventEmitter`, `Logger`, `consoleLogger`, `MetricsCollector` — **plus shared-nothing scale primitives**: `HashRing`, `GossipMembership`, `Membership`, `Clock`, `StateStore`, `MessageBus`, `Lock`, `IdGenerator`. Zero runtime dependencies. |
| `rtcforge-signaling` | `SignalingServer` (+ `createSignalingServer` factory), `Room`, `Peer` — WebSocket signaling, auth hook, **safe defaults on** (rate-limit, payload cap, connection/room caps), heartbeat, `RoomRouter` cluster sharding |
| `rtcforge-sdk` | `RTCForgeClient` (+ `createClient` factory), `Room` — browser + Node.js client; reconnect (with terminal-close handling), send queue, injectable `Transport`; also `rtcforge-sdk/filetransfer` |
| `rtcforge-media` | `Call` (P2P mesh, perfect-negotiation, ICE-restart) + `MediaService`/`MediaRouter` (mediasoup SFU) + `SfuSignalHandler`. **`mediasoup` is an optional peer dependency** — browser-only installs never compile it. |
| `rtcforge-sfu` | `SfuCluster`, `CascadingRouter`, `HashRingStrategy`, `CascadeTree`/`CascadeBridge`, `ReferenceSfuMedia` — multi-node routing, cascade fan-out, health, bandwidth estimation. Ships the gossip wire at `rtcforge-sfu/udp`. |
| `rtcforge-adapter-udp` | **Deprecated** — folded into `rtcforge-sfu/udp`; kept as a thin re-export for backwards compatibility. |

---

## Install & use

Packages are on the public npm registry, unscoped. Most apps install the `rtcforge` meta-package and import from its subpaths:

```bash
npm i rtcforge                 # signaling + client (server / client / filetransfer)
npm i rtcforge rtcforge-media  # add audio/video (rtcforge/media) — optional peer dep
# ...plus `mediasoup` only for the server-side SFU plane
```

```ts
// frontend
import { createClient } from "rtcforge/client";
const room = await createClient({ serverUrl: "wss://your-signaling-host" }).joinRoom("my-room");

// backend — safe defaults on (rate-limit, payload cap, caps) + warn logger
import { createSignalingServer } from "rtcforge/server";
const server = await createSignalingServer({ port: 3001, auth });
```

Or cherry-pick the individual packages (each pulls `rtcforge-core` transitively):

```bash
npm i rtcforge-sdk            # client only
npm i rtcforge-signaling      # backend only
npm i rtcforge-sfu            # scale-out clustering
```

**New here? Which packages for your app + how to wire them → [`docs/BUILDING_APPS.md`](docs/BUILDING_APPS.md)** (chat, video call, live stream, whiteboard, file transfer, 1M-viewer scale).

**Full class-level API reference (every package) → [narrowananth.github.io/rtcforge](https://narrowananth.github.io/rtcforge/).**

**Full install table, server example, publishing, and local testing → [`docs/PUBLISHING.md`](docs/PUBLISHING.md).**


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
