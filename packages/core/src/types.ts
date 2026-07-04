/**
 * Structured logging interface accepted throughout RTCForge.
 *
 * @remarks
 * Every method takes a message and an optional structured context object. Implementations
 * decide how to serialize and route the output. Supply {@link noopLogger} to disable logging.
 */
export interface Logger {
    /**
     * Logs a fine-grained diagnostic message useful during development.
     * @param msg - The log message.
     * @param ctx - Optional structured context to attach to the entry.
     */
    debug(msg: string, ctx?: Record<string, unknown>): void
    /**
     * Logs an informational message about normal operation.
     * @param msg - The log message.
     * @param ctx - Optional structured context to attach to the entry.
     */
    info(msg: string, ctx?: Record<string, unknown>): void
    /**
     * Logs a warning about a recoverable or unexpected condition.
     * @param msg - The log message.
     * @param ctx - Optional structured context to attach to the entry.
     */
    warn(msg: string, ctx?: Record<string, unknown>): void
    /**
     * Logs an error that occurred but did not necessarily halt operation.
     * @param msg - The log message.
     * @param ctx - Optional structured context to attach to the entry.
     */
    error(msg: string, ctx?: Record<string, unknown>): void
    /**
     * Logs a fatal condition, typically preceding process termination.
     * @param msg - The log message.
     * @param ctx - Optional structured context to attach to the entry.
     */
    fatal(msg: string, ctx?: Record<string, unknown>): void
}

/**
 * A {@link Logger} implementation that discards every message.
 *
 * @remarks
 * Use as a default when no logging is desired, avoiding null checks on optional logger fields.
 */
export const noopLogger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
}

/** Ordered severity levels used by {@link consoleLogger}. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    fatal: 50,
}

/**
 * A {@link Logger} that writes to the console at or above `minLevel`. Handy as a
 * sensible default (so silent drops and validation failures are visible) instead
 * of {@link noopLogger}; swap in your own structured logger in production.
 *
 * @param minLevel - Lowest level to emit. @defaultValue `'warn'`
 */
export function consoleLogger(minLevel: LogLevel = 'warn'): Logger {
    const min = LEVEL_ORDER[minLevel]
    const at =
        (level: LogLevel, sink: (msg: string, ctx?: Record<string, unknown>) => void) =>
        (msg: string, ctx?: Record<string, unknown>): void => {
            if (LEVEL_ORDER[level] >= min) ctx ? sink(msg, ctx) : sink(msg)
        }
    return {
        debug: at('debug', (m, c) => console.debug(m, c ?? '')),
        info: at('info', (m, c) => console.info(m, c ?? '')),
        warn: at('warn', (m, c) => console.warn(m, c ?? '')),
        error: at('error', (m, c) => console.error(m, c ?? '')),
        fatal: at('fatal', (m, c) => console.error(m, c ?? '')),
    }
}

/**
 * Sink for operational metrics emitted by RTCForge.
 *
 * @remarks
 * Metric names are typically drawn from {@link Metric}. All methods accept optional
 * string labels for dimensional breakdowns. Supply {@link noopMetrics} to disable collection.
 */
export interface MetricsCollector {
    /**
     * Increments a counter metric by one.
     * @param metric - The metric name.
     * @param labels - Optional key/value labels for dimensional aggregation.
     */
    increment(metric: string, labels?: Record<string, string>): void
    /**
     * Records the current value of a gauge metric.
     * @param metric - The metric name.
     * @param value - The instantaneous value to record.
     * @param labels - Optional key/value labels for dimensional aggregation.
     */
    gauge(metric: string, value: number, labels?: Record<string, string>): void
    /**
     * Records a value into a histogram/distribution metric.
     * @param metric - The metric name.
     * @param value - The observed value to add to the distribution.
     * @param labels - Optional key/value labels for dimensional aggregation.
     */
    histogram(metric: string, value: number, labels?: Record<string, string>): void
    /**
     * Records a duration measurement in milliseconds.
     * @param metric - The metric name.
     * @param ms - The measured duration in milliseconds.
     * @param labels - Optional key/value labels for dimensional aggregation.
     */
    timing(metric: string, ms: number, labels?: Record<string, string>): void
}

/**
 * A {@link MetricsCollector} implementation that discards every measurement.
 *
 * @remarks
 * Use as a default when metrics collection is not wired up.
 */
export const noopMetrics: MetricsCollector = {
    increment: () => {},
    gauge: () => {},
    histogram: () => {},
    timing: () => {},
}

/**
 * Canonical names for the operational metrics RTCForge emits.
 *
 * @remarks
 * Pass these values as the `metric` argument to a {@link MetricsCollector} for consistent
 * metric naming across components. The type alias {@link Metric} is the union of these values.
 */
export const Metric = {
    /** Counter: a room was created. */
    RoomsCreated: 'rooms_created',
    /** Counter: a room was closed. */
    RoomsClosed: 'rooms_closed',
    /** Counter: a peer connected. */
    PeersConnected: 'peers_connected',
    /** Counter: a peer disconnected. */
    PeersDisconnected: 'peers_disconnected',
    /** Counter: a signaling message was relayed between peers. */
    SignalsRelayed: 'signals_relayed',
    /** Counter: a broadcast message was relayed to room members. */
    BroadcastsRelayed: 'broadcasts_relayed',
    /** Counter: an authentication or authorization error occurred. */
    AuthErrors: 'auth_errors',
    /** Gauge: current number of active rooms. */
    ActiveRooms: 'active_rooms',
    /** Gauge: current number of active peers. */
    ActivePeers: 'active_peers',
    /** Counter: a peer was forcibly removed from a room. */
    PeersKicked: 'peers_kicked',
} as const

/**
 * Union of the metric name string literals defined by {@link Metric}.
 */
export type Metric = (typeof Metric)[keyof typeof Metric]

/**
 * Coerces an arbitrary thrown value into an `Error` instance.
 *
 * @param err - The caught value, which may or may not be an `Error`.
 * @returns `err` unchanged if it is already an `Error`; otherwise a new `Error` whose message is `String(err)`.
 *
 * @example
 * ```ts
 * try {
 *   risky()
 * } catch (e) {
 *   const error = toError(e) // guaranteed Error
 *   logger.error(error.message)
 * }
 * ```
 */
export function toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err))
}

/**
 * The kind of media carried by a track or transceiver: `'audio'` or `'video'`.
 */
export type MediaKind = 'audio' | 'video'

/**
 * A snapshot of connection-level network quality statistics.
 */
export interface NetworkStats {
    /** Estimated throughput in bits per second. */
    bitrate: number
    /** Fraction of packets lost, typically in the range `0`–`1`. */
    packetLoss: number
    /** Round-trip time in milliseconds. */
    rtt: number
}
