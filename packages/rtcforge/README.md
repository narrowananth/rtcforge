# rtcforge

One-install front door for [RTCForge](https://github.com/narrowananth/rtcforge) — build real-time WebRTC apps without wiring up six packages.

```bash
npm i rtcforge                 # signaling + client (rtcforge/server, rtcforge/client, rtcforge/filetransfer)
npm i rtcforge rtcforge-media  # add for audio/video (rtcforge/media) — it's an optional peer dep
# ...plus `mediasoup` only for the server-side SFU plane (an optional peer of rtcforge-media)
```

## Entry points

| Import | Re-exports | Runtime |
| ------ | ---------- | ------- |
| `rtcforge/client` | `rtcforge-sdk` — `RTCForgeClient`, `Room` | browser |
| `rtcforge/media` | `rtcforge-media` — `Call`, `getUserMedia`, `MediaService` | browser + node |
| `rtcforge/filetransfer` | `rtcforge-sdk/filetransfer` — `FileTransferManager` | browser |
| `rtcforge/server` | `rtcforge-signaling` — `SignalingServer` | node |

```ts
// frontend
import { RTCForgeClient, RoomEvent } from 'rtcforge/client'
const room = await new RTCForgeClient({ serverUrl, token }).joinRoom('general')

// backend
import { SignalingServer } from 'rtcforge/server'
const server = new SignalingServer({ port: 3001, auth })
await server.start()
```

`rtcforge-media` is an optional peer dependency (it pulls the native `mediasoup`
addon); install it only for the SFU media plane. For fine-grained control or
scale-out clustering, install the underlying `rtcforge-*` packages directly —
see the [monorepo README](https://github.com/narrowananth/rtcforge).
