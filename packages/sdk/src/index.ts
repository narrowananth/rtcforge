export { RTCForgeClient } from './RTCForgeClient.js'
export { Room, RoomMediaEvent } from './Room.js'
export { EventEmitter } from 'rtcforge-core'
export { ClientEvent, RoomEvent, TransportEvent, noopLogger } from './types.js'
export { MessageType } from './protocol.js'
export type {
    RTCForgeClientOptions,
    ConnectionState,
    Logger,
    CallInterface,
    CallTrackControl,
    CallMuteControl,
    CallStatsProvider,
    CallDataChannelFactory,
    RemoteStreamSource,
    CallLifecycle,
    BoundCall,
    IceServerConfig,
    TransportOptions,
    TransportFactory,
} from './types.js'
export type { ServerMessage, ClientMessage } from './protocol.js'
export type { PeerInfo, RoomMediaEvent as RoomMediaEventType } from './Room.js'

export { WebSocketTransport } from './WebSocketTransport.js'
export type { Transport, TransportEvents } from './Transport.js'
export { SendQueue } from './SendQueue.js'
export type { MessageQueue } from './SendQueue.js'
export { ReconnectStrategy } from './ReconnectStrategy.js'
export type { BackoffStrategy } from './ReconnectStrategy.js'
export { JoinHandshake } from './JoinHandshake.js'

// File transfer (browser-safe). Node-only sinks: 'rtcforge-sdk/filetransfer/node'.
export * from './filetransfer/index.js'
