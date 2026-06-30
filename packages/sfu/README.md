# rtcforge-sfu

> Multi-node SFU cluster management for RTCForge — routing, placement, cascade fan-out, and health.

## What

The control plane that turns many single SFU nodes into one cluster. `SfuCluster` tracks nodes, `CascadingRouter` + placement strategies decide which node hosts a room, and `CascadeTree`/`CascadeBridge` chain nodes into a fan-out tree so one stream can reach huge audiences. Includes health checks, failure tracking, and bandwidth estimation.

## Why

A single SFU node has a ceiling — CPU and uplink bandwidth. To serve large or geo-spread rooms (up to the 1M-viewer case in `docs/SCALING.md`), you spread load across nodes and cascade streams between them. This package handles placement and fan-out so the media nodes stay simple.

## Where it fits

```
rtcforge-media (SFU node)  ×N  ←  rtcforge-sfu (cluster control)
                                   ├─ HashRingStrategy / LeastLoadedStrategy → placement
                                   └─ CascadeTree → fan-out across nodes
```

Uses `Membership` from [`rtcforge-core`](https://www.npmjs.com/package/rtcforge-core) for the node roster.

## Architecture

- `SfuCluster` / `SfuNode` — cluster + per-node state.
- `CascadingRouter` — routes rooms to nodes.
- `LeastLoadedStrategy`, `HashRingStrategy` — placement policies.
- `CascadeTree`, `CascadeBridge`, `SfuBridge` — inter-node stream fan-out.
- `NodeFailureTracker`, `SimpleBandwidthEstimator` — health + capacity.

## How to use

```ts
import { SfuCluster, SfuNode, HashRingStrategy } from "rtcforge-sfu";

const cluster = new SfuCluster({
  placementStrategy: new HashRingStrategy(),
  healthCheck: { intervalMs: 5000 },
});

cluster.addNode(new SfuNode("node-a", "us-east"));
cluster.addNode(new SfuNode("node-b", "eu-west"));

const node = cluster.assignNode(undefined, "room-42"); // → which node hosts the room
```

---

Part of **[RTCForge](https://github.com/your-org/rtcforge)**. See [`docs/SCALING.md`](https://github.com/your-org/rtcforge/blob/master/docs/SCALING.md) and [`docs/PUBLISHING.md`](https://github.com/your-org/rtcforge/blob/master/docs/PUBLISHING.md).
