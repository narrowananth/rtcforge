// Video-call signaling server — run: node server.mjs
// For a P2P mesh call the server ONLY relays SDP/ICE; media flows
// directly browser-to-browser. No mediasoup needed for 2-4 peers.
import { createSignalingServer } from "rtcforge/server";

const server = await createSignalingServer({
  port: 3001,
  // DEV ONLY: trust the token as "<peerId>:<roomId>". Real apps MUST verify.
  auth: async (token) => {
    const [peerId, roomId = "room1"] = String(token).split(":");
    if (!peerId) throw new Error("missing peerId");
    return { roomId, peerId, role: "member", metadata: { name: peerId } };
  },
  // Per-peer ICE servers. A public STUN server is enough for same-network demos;
  // production needs TURN for the ~15% of users behind strict NAT.
  iceServersHook: async () => [{ urls: "stun:stun.l.google.com:19302" }],
  maxPeersPerRoom: 4,
});

console.log("Video-call signaling server on ws://localhost:3001");
console.log("Open client.html in two tabs/devices to start a call.");
