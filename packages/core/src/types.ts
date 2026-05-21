export interface Logger {
    debug(msg: string, ctx?: Record<string, unknown>): void
    info(msg: string, ctx?: Record<string, unknown>): void
    warn(msg: string, ctx?: Record<string, unknown>): void
    error(msg: string, ctx?: Record<string, unknown>): void
}

export const noopLogger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
}

export interface MetricsCollector {
    increment(metric: string, labels?: Record<string, string>): void
    gauge(metric: string, value: number, labels?: Record<string, string>): void
}

export const noopMetrics: MetricsCollector = {
    increment: () => {},
    gauge: () => {},
}

export const Metric = {
    RoomsCreated: 'rooms_created',
    RoomsClosed: 'rooms_closed',
    PeersConnected: 'peers_connected',
    PeersDisconnected: 'peers_disconnected',
    SignalsRelayed: 'signals_relayed',
    AuthErrors: 'auth_errors',
    ActiveRooms: 'active_rooms',
    ActivePeers: 'active_peers',
} as const

export type Metric = (typeof Metric)[keyof typeof Metric]
