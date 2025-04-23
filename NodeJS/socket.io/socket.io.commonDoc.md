1. connection:

    - This event is built into socket.io and is triggered when a new client connects to the server. The server listens for this event using io.sockets.on("connection", socket => { ... }) and sets up event listeners for each connected client.

2. broadcaster:

    - This event is triggered by a client that wants to act as the broadcaster in a real-time communication scenario. The server listens for this event using socket.on("broadcaster", () => { ... }) and sets the broadcaster variable to the socket.id of the client. It also broadcasts the "broadcaster" event to all clients except the one that triggered it.

3. watcher:

    - This event is triggered by a client that wants to act as a viewer in a real-time communication scenario. The server listens for this event using socket.on("watcher", () => { ... }) and emits a "watcher" event to the broadcaster with the socket.id of the client.

4. offer:

    - This event is triggered by a client (the viewer) to initiate a real-time communication session with the broadcaster. The server listens for this event using socket.on("offer", (id, message) => { ... }) and emits an "offer" event to the specified id with the socket.id and message of the client.

5. answer:

    - This event is triggered by a client (the broadcaster) in response to an "offer" event from a viewer. The server listens for this event using socket.on("answer", (id, message) => { ... }) and emits an "answer" event to the specified id with the socket.id and message of the client.

6. candidate:

    - This event is used to exchange network information between the broadcaster and viewer during a real-time communication session. The server listens for this event using socket.on("candidate", (id, message) => { ... }) and emits a "candidate" event to the specified id with the socket.id and message of the client.

7. disconnect:
    - This event is built into socket.io and is triggered when a client disconnects from the server. The server listens for this event using socket.on("disconnect", () => { ... }) and emits a "disconnectPeer" event to the broadcaster with the socket.id of the disconnected client.
