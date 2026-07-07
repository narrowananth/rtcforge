// Signaling-plane throughput + fan-out latency benchmark.
//
//   node signaling-throughput.mjs
//   CLIENTS=50 MESSAGES=1000 node signaling-throughput.mjs
//
// One publisher broadcasts MESSAGES messages to a room of CLIENTS subscribers.
// Each message fans out to every subscriber (MESSAGES * CLIENTS deliveries).
// We measure end-to-end delivery latency (publish -> receive, same process
// clock) and overall delivery throughput. All numbers come from YOUR machine —
// nothing here is hard-coded or vendor-tuned.
//
// The RTCForge client runs in Node via its `ws` fallback transport.
import { performance } from "node:perf_hooks";
import { createSignalingServer } from "rtcforge/server";
import { createClient } from "rtcforge/client";

const CLIENTS = Number(process.env.CLIENTS ?? 20);
const MESSAGES = Number(process.env.MESSAGES ?? 500);
const PORT = Number(process.env.PORT ?? 4321);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 30_000);
const ROOM = "bench";
const URL = `ws://localhost:${PORT}`;

const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : Number.NaN;
const ms = (n) => `${n.toFixed(2)} ms`;

async function main() {
  const server = await createSignalingServer({
    port: PORT,
    // dev auth: token is "<peerId>:<roomId>"
    auth: async (token) => {
      const [peerId, roomId = ROOM] = String(token).split(":");
      return { roomId, peerId, role: "member", metadata: {} };
    },
    rateLimit: { maxMessagesPerSecond: 0 }, // disable so we measure the plane, not the limiter
    maxPeersPerRoom: CLIENTS + 10,
  });

  const latencies = [];
  const expected = MESSAGES * CLIENTS;
  let received = 0;
  let resolveDone;
  const allDelivered = new Promise((r) => (resolveDone = r));

  // --- connect subscribers, timing join latency ---
  const subs = [];
  const joinStart = performance.now();
  for (let i = 0; i < CLIENTS; i++) {
    const c = createClient({ serverUrl: URL, token: `sub-${i}:${ROOM}` });
    const room = await c.joinRoom(ROOM);
    room.on("broadcast", (_from, channel, data) => {
      if (channel !== "bench") return;
      latencies.push(performance.now() - data.t);
      if (++received >= expected) resolveDone();
    });
    subs.push(c);
  }
  const joinMs = performance.now() - joinStart;

  // --- publisher ---
  const pub = createClient({ serverUrl: URL, token: `pub:${ROOM}` });
  const proom = await pub.joinRoom(ROOM);

  // --- fire MESSAGES broadcasts ---
  const start = performance.now();
  for (let seq = 0; seq < MESSAGES; seq++) {
    proom.broadcast("bench", { t: performance.now(), seq });
  }

  const timedOut = await Promise.race([
    allDelivered.then(() => false),
    new Promise((r) => setTimeout(() => r(true), TIMEOUT_MS)),
  ]);
  const elapsed = performance.now() - start;

  latencies.sort((a, b) => a - b);
  const deliveries = latencies.length;
  const throughput = (deliveries / elapsed) * 1000;

  console.log("\n=== RTCForge signaling benchmark ===");
  console.log(`clients (subscribers) : ${CLIENTS}`);
  console.log(`messages (per publish): ${MESSAGES}`);
  console.log(`expected deliveries   : ${expected}`);
  console.log(`actual deliveries     : ${deliveries}${timedOut ? "  ⚠️  TIMED OUT (incomplete)" : ""}`);
  console.log("-".repeat(38));
  console.log(`join ${CLIENTS} clients    : ${ms(joinMs)}  (${ms(joinMs / CLIENTS)}/client)`);
  console.log(`fan-out wall time     : ${ms(elapsed)}`);
  console.log(`delivery throughput   : ${throughput.toFixed(0)} msgs/sec`);
  console.log("-- delivery latency (publish -> receive) --");
  console.log(`  p50 : ${ms(pct(latencies, 50))}`);
  console.log(`  p90 : ${ms(pct(latencies, 90))}`);
  console.log(`  p99 : ${ms(pct(latencies, 99))}`);
  console.log(`  max : ${ms(latencies[latencies.length - 1] ?? Number.NaN)}`);
  console.log(`\nnode ${process.version} · ${process.platform}/${process.arch}\n`);

  await pub.leave().catch(() => {});
  await Promise.all(subs.map((c) => c.leave().catch(() => {})));
  await server.stop().catch(() => {});
  process.exit(timedOut ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
