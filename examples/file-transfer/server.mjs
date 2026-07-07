// File-transfer signaling server — run: node server.mjs
// Files move DIRECTLY peer-to-peer over a WebRTC data channel; the server
// only relays SDP/ICE to establish the connection and never sees the bytes.
import { createSignalingServer } from "rtcforge/server";

const server = await createSignalingServer({
  port: 3001,
  // DEV ONLY: trust the token as "<peerId>:<roomId>". Real apps MUST verify.
  auth: async (token) => {
    const [peerId, roomId = "drop"] = String(token).split(":");
    if (!peerId) throw new Error("missing peerId");
    return { roomId, peerId, role: "member", metadata: { name: peerId } };
  },
  iceServersHook: async () => [{ urls: "stun:stun.l.google.com:19302" }],
  maxPeersPerRoom: 4,
});

console.log("File-transfer signaling server on ws://localhost:3001");
console.log("Open client.html in two tabs, then pick a file to send.");
