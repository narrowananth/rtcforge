import dgram from 'node:dgram'
import { type Logger, noopLogger } from 'rtcforge-core'
import type { GossipMessage, GossipTransport } from 'rtcforge-core'

const MAX_DATAGRAM = 65_507

export interface UdpGossipTransportOptions {
    port: number
    bindHost?: string
    advertiseHost?: string
    logger?: Logger
}

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

    get address(): string {
        return `${this._advertiseHost}:${this._port}`
    }

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

    onReceive(handler: (msg: GossipMessage) => void): void {
        this._handler = handler
    }

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
