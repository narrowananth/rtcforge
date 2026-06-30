# Publishing & Using RTCForge Packages

Single source for installing, publishing, and locally testing every `rtcforge-*` package. Public registry, unscoped, prefixed `rtcforge-`.

| Package | Install | Entry point |
| ------- | ------- | ----------- |
| `rtcforge-core` | (transitive — never install directly) | primitives + scale primitives |
| `rtcforge-sdk` | `npm i rtcforge-sdk` | `RTCForgeClient` |
| `rtcforge-signaling` | `npm i rtcforge-signaling` | `SignalingServer` |
| `rtcforge-media` | `npm i rtcforge-media rtcforge-core rtcforge-sdk rtcforge-signaling` | `Call`, `MediaService` |
| `rtcforge-sfu` | `npm i rtcforge-sfu` | `SfuCluster` |
| `rtcforge-adapter-udp` | `npm i rtcforge-adapter-udp` | `UdpGossipTransport` |

> `rtcforge-media` peer deps are **not** auto-installed. Everything else pulls `rtcforge-core` transitively.

---

## Use

```ts
// client
import { RTCForgeClient } from "rtcforge-sdk";
const client = new RTCForgeClient({ serverUrl: "wss://your-signaling-host" });
const room = await client.joinRoom("my-room"); // connects + joins

// server
import { SignalingServer } from "rtcforge-signaling";
const server = new SignalingServer({ port: 3001 });
await server.start();
```

---

## Publish to npm

Prereqs: `npm login` (or automation token), 2FA, build first (only `dist/` ships).

```bash
npm config set //registry.npmjs.org/:_authToken <TOKEN>   # optional, bypasses 2FA in CI
npm run build

# publish in dependency order
( cd packages/core && npm publish )                                  # foundation
for p in sdk signaling sfu adapter-udp; do ( cd packages/$p && npm publish ); done
( cd packages/media && npm publish )                                 # composed

# verify
for p in core sdk signaling sfu adapter-udp media; do npm view rtcforge-$p version; done
```

Per-package OTP prompt: append `--otp=<code>`. Bump before re-publish (npm rejects existing versions): `npm version patch --workspaces`. Stay on `0.x` until the API is frozen; cut `1.0.0` when production-ready.

---

## Test locally (before a real release)

```bash
# A. npm pack — exact tarball npm would upload
cd packages/sdk && npm run build && npm pack          # → rtcforge-sdk-0.1.0.tgz
npm install /abs/path/to/rtcforge-sdk-0.1.0.tgz       # in a test project

# B. npm link — live edits in a consumer
cd packages/sdk && npm link
cd /path/to/test-app && npm link rtcforge-sdk         # npm unlink to undo

# C. Verdaccio — full publish/install round-trip, nothing leaves the machine
npx verdaccio                                          # http://localhost:4873
npm publish --registry http://localhost:4873
npm install rtcforge-sdk --registry http://localhost:4873
```
