# rtcforge-core

> Zero-dependency foundation for RTCForge — shared primitives plus the building blocks for shared-nothing multi-node scale-out.

📖 **[Full API reference →](https://narrowananth.github.io/rtcforge/modules/rtcforge-core.html)**

## What

The base package every other `rtcforge-*` package depends on. Two kinds of primitives:

- **Shared** — `EventEmitter`, `Logger`/`MetricsCollector` interfaces (+ `noopLogger`, `consoleLogger`), typed errors, `IdGenerator`, `Clock`.
- **Scale-out** — `HashRing` (consistent hashing), `GossipMembership` + `GossipNetwork` (SWIM-style cluster membership), `Membership`, `StateStore`, `MessageBus`, `Lock`. These let RTCForge cluster across nodes **without Redis or etcd**.

## Why

Real-time clustering usually drags in external coordination services. RTCForge keeps coordination in-process: a consistent-hash ring decides which node owns a room, gossip spreads membership. `core` is that toolkit, dependency-free so it runs anywhere.

## Where it fits

```
core  ←  signaling, sdk, sfu, adapter-udp, media   (everything builds on core)
```

You rarely install it directly — it arrives transitively with any other package.

## How to use

```ts
import { HashRing, GossipMembership } from "rtcforge-core";

// consistent-hash routing: which node owns a room?
const ring = new HashRing(["node-a", "node-b", "node-c"]);
const owner = ring.get("room-42");   // → stable node id

ring.add("node-d");                  // ring rebalances minimally
ring.remove("node-a");
```

Gossip membership pairs with a transport (e.g. [`rtcforge-adapter-udp`](https://www.npmjs.com/package/rtcforge-adapter-udp)) to track live nodes across a cluster.

---

Part of **[RTCForge](https://github.com/narrowananth/rtcforge)** — build real-time apps without reinventing the infrastructure. See [`docs/PUBLISHING.md`](https://github.com/narrowananth/rtcforge/blob/master/docs/PUBLISHING.md).
