import dgram from 'node:dgram'
import { type Logger, noopLogger } from 'rtcforge-core'
import type { GossipMessage, GossipTransport } from 'rtcforge-core'

const MAX_DATAGRAM = 65_507

/**
 * Configuration for a {@link UdpGossipTransport}.
 *
 * @remarks
 * `bindHost` controls the local interface the UDP socket listens on, while
 * `advertiseHost` controls the host that peers are told to reply to (exposed
 * via {@link UdpGossipTransport.address}). These are separated so a node can
 * bind broadly (e.g. `0.0.0.0`) yet advertise a specific routable address.
 */
export interface UdpGossipTransportOptions {
    /**
     * UDP port to bind. Pass `0` to let the OS assign an ephemeral port; the
     * concrete port is resolved during {@link UdpGossipTransport.listen} and
     * then reflected in {@link UdpGossipTransport.address}.
     */
    port: number
    /**
     * Local interface address to bind the socket to.
     *
     * @defaultValue `'0.0.0.0'` (all IPv4 interfaces)
     */
    bindHost?: string
    /**
     * Host advertised to peers as the reply-to address. Combined with the bound
     * port to form {@link UdpGossipTransport.address}.
     *
     * @defaultValue `'127.0.0.1'`
     */
    advertiseHost?: string
    /**
     * Logger for socket errors and dropped-datagram diagnostics.
     *
     * @defaultValue a no-op logger that discards all output
     */
    logger?: Logger
}

/**
 * A connectionless UDP implementation of the {@link GossipTransport} interface
 * from `rtcforge-core`.
 *
 * @remarks
 * This is the only socket-level code in the gossip path: it provides a real
 * cross-host wire for SWIM-style membership gossip, in contrast to the
 * in-memory transport used for single-process testing. Each gossip message is
 * serialized to JSON and sent as a single UDP datagram (IPv4, `udp4`). Because
 * UDP is unreliable and unordered, no delivery, ordering, or de-duplication
 * guarantees are made — the gossip protocol layered on top is expected to
 * tolerate loss and reordering.
 *
 * Inbound datagrams are JSON-parsed and structurally validated before being
 * handed to the receive handler; malformed or unparseable datagrams are
 * silently dropped (logged at warn level) rather than throwing. Outbound
 * payloads that exceed the maximum UDP datagram size (65,507 bytes) are dropped
 * with a warning.
 *
 * @example
 * ```ts
 * import { GossipMembership } from 'rtcforge-core'
 * import { UdpGossipTransport } from 'rtcforge-adapter-udp'
 *
 * const transport = new UdpGossipTransport({
 *   port: 7946,
 *   advertiseHost: '10.0.0.4',
 * })
 * await transport.listen()
 *
 * const membership = new GossipMembership(
 *   { id: 'node-a' },
 *   transport,
 *   { seeds: ['10.0.0.5:7946'] },
 * )
 * membership.start()
 *
 * // On shutdown:
 * membership.stop()
 * transport.close()
 * ```
 */
export class UdpGossipTransport implements GossipTransport {
    private readonly _socket: dgram.Socket
    private readonly _bindHost: string
    private readonly _advertiseHost: string
    private readonly _logger: Logger
    private _port: number
    private _handler?: (msg: GossipMessage) => void
    private _closed = false
    private _lastMsg: GossipMessage | undefined
    private _lastPayload: Buffer | undefined

    /**
     * Creates the transport and its underlying `udp4` socket.
     *
     * @remarks
     * The socket is created and wired to internal message and error handlers,
     * but is **not** bound to a port until {@link listen} is called. Errors
     * emitted by the socket after binding are logged rather than thrown.
     *
     * @param opts - Transport configuration; see {@link UdpGossipTransportOptions}.
     */
    constructor(opts: UdpGossipTransportOptions) {
        this._port = opts.port
        this._bindHost = opts.bindHost ?? '0.0.0.0'
        this._advertiseHost = opts.advertiseHost ?? '127.0.0.1'
        this._logger = opts.logger ?? noopLogger
        this._socket = dgram.createSocket('udp4')

        this._socket.on('message', (data) => this._onDatagram(data))
        this._socket.on('error', (err) => {
            this._logger.error('UDP gossip socket error', { err: err.message })
        })
    }

    /**
     * The reply-to address peers should use to reach this node, in
     * `host:port` form.
     *
     * @remarks
     * Composed from the configured `advertiseHost` and the bound port. When the
     * transport was constructed with `port: 0`, the reported port is only the
     * OS-assigned value after {@link listen} has resolved; before that it is
     * the requested port. Consumed by `GossipMembership` to register this node
     * and to advertise itself to peers.
     */
    get address(): string {
        return `${this._advertiseHost}:${this._port}`
    }

    /**
     * Binds the UDP socket to the configured `bindHost` and port, beginning
     * reception of datagrams.
     *
     * @remarks
     * If the transport was configured with `port: 0`, the OS-assigned ephemeral
     * port is resolved here and thereafter reflected in {@link address}. Must be
     * called before the transport can receive messages. This method is specific
     * to the UDP transport and is not part of the {@link GossipTransport}
     * interface.
     *
     * @returns A promise that resolves once the socket is bound and listening.
     * @throws If binding fails (for example, the port is already in use), the
     * returned promise rejects with the socket error.
     */
    listen(): Promise<void> {
        return new Promise((resolve, reject) => {
            const onError = (err: Error) => reject(err)
            this._socket.once('error', onError)
            this._socket.bind(this._port, this._bindHost, () => {
                this._socket.removeListener('error', onError)
                this._port = this._socket.address().port
                resolve()
            })
        })
    }

    /**
     * Serializes a gossip message to JSON and sends it as a single UDP
     * datagram to the given peer.
     *
     * @remarks
     * This call is fire-and-forget: it returns immediately and does not report
     * delivery. Failures are handled defensively and logged rather than thrown —
     * the message is silently dropped when the transport is closed, when
     * `toAddress` cannot be parsed into a `host:port`, when JSON serialization
     * fails, when the send itself errors, or when the payload exceeds the
     * maximum UDP datagram size of 65,507 bytes. As an optimization, the most
     * recently serialized message and its payload buffer are cached, so
     * fanning the same message object out to multiple peers serializes it once.
     *
     * @param toAddress - Destination in `host:port` form (the peer's advertised
     * {@link address}).
     * @param msg - The gossip message to send.
     */
    send(toAddress: string, msg: GossipMessage): void {
        if (this._closed) return
        const { host, port } = parseAddress(toAddress)
        if (port === undefined) {
            this._logger.warn('UDP gossip: bad target address', { toAddress })
            return
        }
        let payload: Buffer
        if (msg === this._lastMsg && this._lastPayload !== undefined) {
            payload = this._lastPayload
        } else {
            try {
                payload = Buffer.from(JSON.stringify(msg))
            } catch (err) {
                this._logger.error('UDP gossip: serialize failed', { err: String(err) })
                return
            }
            this._lastMsg = msg
            this._lastPayload = payload
        }
        if (payload.byteLength > MAX_DATAGRAM) {
            this._logger.warn('UDP gossip: datagram too large, dropped', {
                bytes: payload.byteLength,
            })
            return
        }
        this._socket.send(payload, port, host, (err) => {
            if (err) this._logger.warn('UDP gossip: send failed', { toAddress, err: err.message })
        })
    }

    /**
     * Registers the callback invoked for each validated inbound gossip message.
     *
     * @remarks
     * Only one handler is retained; calling this again replaces the previous
     * handler. The handler is invoked only after {@link listen} has bound the
     * socket and only for datagrams that parse as JSON and pass structural
     * validation — malformed datagrams are dropped before reaching it.
     *
     * @param handler - Receiver invoked with each sanitized {@link GossipMessage}.
     */
    onReceive(handler: (msg: GossipMessage) => void): void {
        this._handler = handler
    }

    /**
     * Closes the underlying UDP socket and stops sending and receiving.
     *
     * @remarks
     * Idempotent: subsequent calls are no-ops. After closing, {@link send}
     * becomes a no-op and no further messages are delivered to the receive
     * handler.
     */
    close(): void {
        if (this._closed) return
        this._closed = true
        this._socket.close()
    }

    private _onDatagram(data: Buffer): void {
        if (!this._handler) return
        let parsed: unknown
        try {
            parsed = JSON.parse(data.toString())
        } catch {
            return
        }
        const msg = sanitizeGossipMessage(parsed)
        if (msg === null) {
            this._logger.warn('UDP gossip: dropped malformed datagram')
            return
        }
        this._handler(msg)
    }
}

function sanitizeGossipMessage(parsed: unknown): GossipMessage | null {
    if (parsed === null || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.from !== 'string' || !Array.isArray(obj.members)) return null

    const members: GossipMessage['members'] = []
    for (const raw of obj.members) {
        if (raw === null || typeof raw !== 'object') continue
        const e = raw as Record<string, unknown>
        if (typeof e.id !== 'string' || e.id.length === 0) continue
        if (typeof e.incarnation !== 'number' || !Number.isFinite(e.incarnation)) continue
        if (typeof e.alive !== 'boolean') continue
        members.push({
            id: e.id,
            incarnation: e.incarnation,
            alive: e.alive,
            ...(typeof e.address === 'string' ? { address: e.address } : {}),
            ...(typeof e.region === 'string' ? { region: e.region } : {}),
            ...(isStringRecord(e.metadata) ? { metadata: e.metadata } : {}),
        })
    }
    if (obj.members.length > 0 && members.length === 0) return null
    return { from: obj.from, members }
}

function isStringRecord(v: unknown): v is Record<string, string> {
    if (v === null || typeof v !== 'object') return false
    return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
}

function parseAddress(address: string): { host: string; port: number | undefined } {
    const idx = address.lastIndexOf(':')
    if (idx <= 0) return { host: address, port: undefined }
    const host = address.slice(0, idx)
    const port = Number(address.slice(idx + 1))
    return { host, port: Number.isInteger(port) && port > 0 ? port : undefined }
}
