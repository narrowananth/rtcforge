// Chat signaling server — run: node server.mjs
// The signaling channel is an authenticated, room-scoped message bus.
// Chat, typing, and presence are just messages you relay.
import { createSignalingServer } from "rtcforge/server";

const server = await createSignalingServer({
  port: 3001,
  // DEV ONLY: trust the token as "<peerId>:<roomId>". Real apps MUST verify.
  auth: async (token) => {
    const [peerId, roomId = "general"] = String(token).split(":");
    if (!peerId) throw new Error("missing peerId");
    return { roomId, peerId, role: "member", metadata: { name: peerId } };
  },
  maxPeersPerRoom: 200,
});

console.log("Chat signaling server on ws://localhost:3001");
console.log("Open client.html in two tabs to chat.");
