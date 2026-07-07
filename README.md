# RTCForge

[![npm version](https://img.shields.io/npm/v/rtcforge.svg)](https://www.npmjs.com/package/rtcforge)
[![npm downloads](https://img.shields.io/npm/dm/rtcforge.svg)](https://www.npmjs.com/package/rtcforge)
[![CI](https://github.com/narrowananth/rtcforge/actions/workflows/ci.yml/badge.svg)](https://github.com/narrowananth/rtcforge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)

Open-source npm library for building real-time communication systems on top of WebRTC.

Composable packages, pick the layers you need: WebSocket **signaling**, a browser/Node **client SDK**, a **media plane** (P2P mesh `Call` + mediasoup **SFU**), and **shared-nothing multi-node scale-out** (consistent-hash routing + gossip membership — **no Redis/etcd**). It stops at the transport boundary — chat, presence, recording, and whiteboard are built in *your* application layer on the primitives it exposes. See [`docs/BUILDING_APPS.md`](docs/BUILDING_APPS.md).

**One install for most apps** — the [`rtcforge`](packages/rtcforge) meta-package fronts the whole stack:

```bash
npm i rtcforge                 # signaling server + client + P2P media + file transfer
npm i rtcforge mediasoup       # add the server-side SFU (mediasoup is an optional peer dep)
```

```ts
import { createClient } from "rtcforge/client"           // browser
import { createSignalingServer } from "rtcforge/server"   // node
```

`rtcforge` is the **only published package** — everything is imported from its
subpaths (`rtcforge/server`, `/client`, `/media`, `/filetransfer`, `/sfu`,
`/core`). The `rtcforge-*` packages listed under [Project Structure](#project-structure)
are internal modules bundled into `rtcforge`, not separate installs.

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
 ├── packages/                  # rtcforge is the only PUBLISHED package; the rest are internal
 │    ├── rtcforge/       # rtcforge (PUBLISHED)  — bundles the modules below behind subpaths
 │    ├── core/           # rtcforge-core        → rtcforge/core   — primitives + scale primitives (zero deps)
 │    ├── signaling/      # rtcforge-signaling   → rtcforge/server — WebSocket signaling, RoomRouter cluster
 │    ├── sdk/            # rtcforge-sdk         → rtcforge/client + /filetransfer — browser + Node client
 │    ├── media/          # rtcforge-media       → rtcforge/media  — P2P mesh Call + mediasoup SFU
 │    └── sfu/            # rtcforge-sfu         → rtcforge/sfu (+ /udp) — multi-node cluster, cascade fan-out
 │
 ├── docs/BUILDING_APPS.md # Implementation guide — which packages per app type + wiring
 ├── e2e/                  # Real-browser (Playwright) end-to-end tests
 ├── .changeset/           # Versioning + CHANGELOG automation
 ├── biome.json            # Lint + format config (Biome)
 ├── tsconfig.base.json    # Shared TypeScript config
 └── tsconfig.json         # Root typecheck (references all packages)
```

> RTCForge is a **two-layer** library: `rtcforge` is the **core transport
> layer**; features like chat, presence, and whiteboard live in **your
> application layer**, built on the transport primitives (`rtcforge/client` +
> `rtcforge/server`). See [`docs/BUILDING_APPS.md`](docs/BUILDING_APPS.md).

Each package under `packages/` follows the same layout:

```
packages/<name>/
 ├── src/
 │    └── index.ts
 ├── package.json
 └── tsconfig.json
```

---

## Entry points

`rtcforge` is the only published package. Import each layer from a subpath:

| Import | Description |
| ------ | ----------- |
| `rtcforge/server` | `SignalingServer` (+ `createSignalingServer` factory), `Room`, `Peer`, `RoomRouter` — WebSocket signaling, auth hook, **safe defaults on** (rate-limit, payload cap, connection/room caps), heartbeat, cluster sharding. |
| `rtcforge/client` | `RTCForgeClient` (+ `createClient` factory), `Room`, `ClientEvent`, `RoomEvent` — browser + Node client; reconnect (with terminal-close handling), send queue, injectable `Transport`. |
| `rtcforge/media` | `Call` + `getUserMedia` (P2P mesh, perfect-negotiation, ICE-restart) · `MediaService`/`MediaRouter`/`SfuSignalHandler` (mediasoup SFU). Resolves to a **mediasoup-free browser build** under a bundler's `browser` condition; `mediasoup` is an **optional peer dependency**. |
| `rtcforge/filetransfer` (+ `/node`) | `FileTransferManager`, sinks (`MemorySink`, `FileSystemAccessSink`), `DataChannelHub` — chunked, checksummed P2P file transfer. `/node` adds `fs`-backed sources & sinks. |
| `rtcforge/sfu` (+ `/udp`) | `SfuCluster`, `CascadingRouter`, `HashRingStrategy`, `CascadeTree`/`CascadeBridge`, `ReferenceSfuMedia` — multi-node routing, cascade fan-out, health, bandwidth estimation. `/udp` is the `UdpGossipTransport` wire. |
| `rtcforge/core` | `EventEmitter`, `Logger`, `consoleLogger`, `MetricsCollector` + scale primitives: `HashRing`, `GossipMembership`, `Membership`, `Clock`, `StateStore`, `MessageBus`, `Lock`, `IdGenerator`. Zero runtime dependencies. |

---

## Install & use

`rtcforge` is on the public npm registry, unscoped. Install it and import from its subpaths:

```bash
npm i rtcforge                 # signaling server + client + P2P media + file transfer
npm i rtcforge mediasoup       # add the server-side SFU (mediasoup is an optional peer dep)
```

```ts
// frontend
import { createClient } from "rtcforge/client";
const room = await createClient({ serverUrl: "wss://your-signaling-host" }).joinRoom("my-room");

// backend — safe defaults on (rate-limit, payload cap, caps) + warn logger
import { createSignalingServer } from "rtcforge/server";
const server = await createSignalingServer({ port: 3001, auth });
```

**New here? Which packages for your app + how to wire them → [`docs/BUILDING_APPS.md`](docs/BUILDING_APPS.md)** (chat, video call, live stream, whiteboard, file transfer, 1M-viewer scale).

**Full example apps → [rtcforge_demo_app](https://github.com/narrowananth/rtcforge_demo_app)** — five real-time products on one stack: WhatsApp-style **chat**, **live streaming**, **collaborative** whiteboard, **meet** (P2P mesh + SFU), and **massive** (multi-node cascade cluster). React/Chakra frontends + Node backends.

**Minimal quick-start examples → [`examples/`](examples).** Zero-build: a Node signaling server + a browser client you open directly (chat, video call, file transfer).

**Migrating?** Guides from [raw WebRTC](docs/migrations/from-raw-webrtc.md), [simple-peer](docs/migrations/from-simple-peer.md), and [PeerJS](docs/migrations/from-peerjs.md) · [how RTCForge compares](docs/COMPARISON.md) · [benchmark harness](benchmarks).

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
