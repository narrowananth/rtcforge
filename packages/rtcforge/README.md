# rtcforge

**The one package for real-time WebRTC apps.** Signaling server, browser client,
media, and file transfer — install `rtcforge` and nothing else.

> The `rtcforge-*` packages (`rtcforge-core`, `-sdk`, `-signaling`, `-media`,
> `-sfu`) are internal building blocks. You don't install them directly — just use
> `rtcforge`.

```bash
npm i rtcforge                 # signaling server + browser client + file transfer
npm i rtcforge rtcforge-media  # add audio/video (optional peer dependency)
```

## Entry points

Import only the surface you need — bundlers tree-shake the rest.

| Import | What you get | Runtime |
| ------ | ------------ | ------- |
| `rtcforge/client` | `RTCForgeClient`, `Room`, `RoomEvent` | browser |
| `rtcforge/server` | `SignalingServer` | node |
| `rtcforge/media` | `Call`, `getUserMedia`, `MediaService` | browser + node |
| `rtcforge/filetransfer` | `FileTransferManager` | browser |

## Quickstart

```ts
// backend — signaling server
import { SignalingServer } from 'rtcforge/server'

const server = new SignalingServer({ port: 3001, auth })
await server.start()
```

```ts
// frontend — connect, join a room, exchange messages
import { RTCForgeClient, RoomEvent } from 'rtcforge/client'

const client = new RTCForgeClient({ serverUrl: 'ws://localhost:3001', token })
const room = await client.joinRoom('general')

room.on(RoomEvent.PeerJoined, (peerId) => console.log('joined:', peerId))
room.broadcast('chat', { text: 'hello' })
room.on(RoomEvent.Broadcast, (from, channel, data) => {
  if (channel === 'chat') console.log(from, data)
})
```

Audio/video lives behind `rtcforge/media` and needs the `rtcforge-media` optional
peer dependency (it pulls the native `mediasoup` addon, so it's opt-in — browser
P2P and signaling work without it).

## Docs

- **[Full API reference →](https://narrowananth.github.io/rtcforge/)**
- **[Building apps guide →](https://github.com/narrowananth/rtcforge/blob/master/docs/BUILDING_APPS.md)**
- **[Source & monorepo →](https://github.com/narrowananth/rtcforge)**

MIT © narrowananth
