# rtcforge-adapter-udp

> UDP transport for RTCForge gossip — the network wire that makes `rtcforge-core` membership real across machines.

📖 **[Full API reference →](https://narrowananth.github.io/rtcforge/modules/rtcforge-adapter-udp.html)**

## What

`UdpGossipTransport` — a connectionless UDP socket that carries gossip messages between nodes. It implements the `GossipTransport` interface from [`rtcforge-core`](https://www.npmjs.com/package/rtcforge-core), turning in-memory `GossipMembership` into a real cross-host cluster. This is the only socket code in the gossip path.

## Why

`rtcforge-core` ships gossip membership with an in-memory transport (great for tests, useless across machines). To actually cluster nodes you need a wire. UDP fits gossip: connectionless, low-overhead, tolerant of dropped packets since gossip is eventually-consistent by design.

## Where it fits

```
rtcforge-core (GossipMembership)  →  rtcforge-adapter-udp (UdpGossipTransport)  →  network
```

Plug it into core's gossip; `rtcforge-sfu` then reads the resulting node roster for placement.

## How to use

```ts
import { GossipMembership } from "rtcforge-core";
import { UdpGossipTransport } from "rtcforge-adapter-udp";

const transport = new UdpGossipTransport({
  port: 7946,
  advertiseHost: "10.0.0.5", // address other nodes reach this one on
});

const membership = new GossipMembership(
  { id: "node-a", address: "10.0.0.5:7946" }, // this node (NodeInfo)
  transport,
);
// membership now spreads + receives node state over UDP
```

---

Part of **[RTCForge](https://github.com/narrowananth/rtcforge)**. See [`docs/PUBLISHING.md`](https://github.com/narrowananth/rtcforge/blob/master/docs/PUBLISHING.md).
