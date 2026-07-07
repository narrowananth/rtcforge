# P2P file transfer example

Send a file **directly peer-to-peer** over a WebRTC data channel — chunked, checksummed, backpressured. The server only relays SDP/ICE; it never sees the bytes. Uses `rtcforge/server` + `rtcforge/client` + `rtcforge/media` + `rtcforge/filetransfer` — **no mediasoup**.

## Run

```bash
npm install
node server.mjs        # ws://localhost:3001
```

Open `client.html` in **two tabs**. Wait for "peer connected", pick a file in one tab, click **Send**. The other tab shows progress and a download link.

## How it works

`FileTransferManager` is transport-agnostic — it takes a **`DataChannelHub`**. A data-only `Call` already satisfies that interface:

- `call.createDataChannel(peerId, label, opts)` — opens outbound channels.
- `call.on("data-channel", (peerId, channel) => …)` — surfaces inbound channels.

So we pass the `Call` straight in:

```ts
const call = new Call(room, { stream: new MediaStream(), iceServers: room.iceServers });
room.bindCall(call);
call.start();

const ft = new FileTransferManager(call, { checksum: true });

// Send
const transfer = ft.sendFile(peerId, file, { chunkSize: 32 * 1024 });
transfer.on("progress", (p) => updateBar(p.ratio));

// Receive
ft.on(FileTransferEvent.IncomingOffer, (incoming) => {
  incoming.accept(new MemorySink());
  incoming.on("complete", () => download(incoming.result.blob, incoming.fileName));
});
```

On Node, import fs-backed sources & sinks from `rtcforge/filetransfer/node` to stream large files without buffering them in memory. See [`docs/BUILDING_APPS.md`](../../docs/BUILDING_APPS.md#3-p2p-file-transfer).
