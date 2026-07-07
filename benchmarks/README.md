# RTCForge Benchmarks

Runnable harnesses that measure RTCForge on **your** hardware and network. We deliberately publish **no headline numbers** in marketing copy — real-time performance is dominated by your CPU, NIC, OS scheduler, and (for media) codec/bitrate settings. Numbers below are illustrative single-machine runs, clearly labelled; reproduce them yourself.

## Run

```bash
npm install
npm run bench                              # defaults: 20 clients, 500 messages
CLIENTS=50 MESSAGES=1000 npm run bench     # scale it up
```

Requires Node.js `>= 18`. The RTCForge client runs in Node via its `ws` fallback transport (installed here as a dev dependency).

## `signaling-throughput.mjs`

Boots a real `SignalingServer` on localhost, connects `CLIENTS` subscriber clients into one room, then has a single publisher broadcast `MESSAGES` messages. Each message fans out to every subscriber, so total deliveries = `MESSAGES × CLIENTS`. It reports:

- **join time** — wall time to connect + join all clients (and per-client).
- **fan-out wall time** — time from first publish to last delivery.
- **delivery throughput** — total deliveries per second.
- **delivery latency** — publish → receive, same-process clock, p50/p90/p99/max.

Rate limiting is **disabled** (`rateLimit.maxMessagesPerSecond: 0`) so you measure the plane itself, not the limiter.

### Interpreting latency

The publisher fires all `MESSAGES` in a tight loop, so this is a **burst** test: reported latency includes time each message spends queued behind the ones ahead of it. Expect p50 latency to track fan-out wall time — that's the queuing cost of a burst, **not** an idle round-trip. For idle RTT, run with `MESSAGES=1` repeatedly, or add pacing. Throughput is the headline metric here; latency is "latency under sustained burst load."

### Example run (illustrative — one machine)

```
clients (subscribers) : 20
messages (per publish): 500
expected deliveries   : 10000
actual deliveries     : 10000
join 20 clients       : ~53 ms   (~2.7 ms/client)
delivery throughput   : ~90k+ msgs/sec
(Apple Silicon, Node 24, localhost — your numbers will differ)
```

A non-zero exit code means the run **timed out** before all deliveries arrived (raise `TIMEOUT_MS`, or you found a backpressure limit worth reporting).

## What's not here yet

- **Media-plane benchmarks** (SFU forwarding CPU, cascade fan-out) need a browser + camera/mic for the real RTP path and a mediasoup worker — see the media apps in [rtcforge_demo_app](https://github.com/narrowananth/rtcforge_demo_app) for end-to-end media. Contributions welcome (see [ROADMAP](../ROADMAP.md)).
- **Comparison vs. other libraries** — for honest apples-to-apples numbers, run each project's own equivalent on the same box. The [feature comparison](../docs/COMPARISON.md) covers capabilities, not speed.
