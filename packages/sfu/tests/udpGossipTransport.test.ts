import { createHmac } from 'node:crypto'
import dgram from 'node:dgram'
import { GossipMembership } from 'rtcforge-core'
import type { GossipMessage } from 'rtcforge-core'
import { afterEach, describe, expect, it } from 'vitest'
import { UdpGossipTransport } from '../src/udp.js'

const LOCAL = '127.0.0.1'

function transport(secret?: string): UdpGossipTransport {
    return new UdpGossipTransport({ port: 0, bindHost: LOCAL, advertiseHost: LOCAL, secret })
}

const nextMessage = (t: UdpGossipTransport): Promise<GossipMessage> =>
    new Promise((resolve) => t.onReceive(resolve))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('UdpGossipTransport — wire', () => {
    const cleanup: UdpGossipTransport[] = []
    afterEach(() => {
        for (const t of cleanup) t.close()
        cleanup.length = 0
    })

    it('address reflects the OS-assigned port after listen', async () => {
        const t = transport()
        cleanup.push(t)
        await t.listen()
        const [host, port] = t.address.split(':')
        expect(host).toBe(LOCAL)
        expect(Number(port)).toBeGreaterThan(0)
    })

    it('delivers a gossip message from sender to receiver', async () => {
        const a = transport()
        const b = transport()
        cleanup.push(a, b)
        await a.listen()
        await b.listen()

        const received = nextMessage(b)
        const msg: GossipMessage = {
            from: 'a',
            members: [{ id: 'a', incarnation: 1, alive: true }],
        }
        a.send(b.address, msg)
        expect(await received).toEqual(msg)
    })

    it('with a shared secret, accepts HMAC-signed peers and drops unsigned/wrong-secret ones', async () => {
        // Regression (REVIEW.md HIGH #22/#23): unauthenticated gossip lets anyone
        // inject/reflect membership. With a secret, only correctly-signed
        // datagrams are delivered.
        const a = transport('shared-secret')
        const b = transport('shared-secret')
        const attacker = transport('wrong-secret')
        cleanup.push(a, b, attacker)
        await a.listen()
        await b.listen()
        await attacker.listen()

        const delivered: GossipMessage[] = []
        b.onReceive((m) => delivered.push(m))

        const legit: GossipMessage = {
            from: 'a',
            members: [{ id: 'a', incarnation: 1, alive: true }],
        }
        const spoof: GossipMessage = {
            from: 'evil',
            members: [{ id: 'victim', incarnation: 999, alive: false }],
        }
        attacker.send(b.address, spoof) // wrong MAC → dropped
        a.send(b.address, legit) // valid MAC → delivered
        await sleep(50)

        expect(delivered).toEqual([legit])
    })

    it('drops a replayed datagram with a stale timestamp (valid MAC, old ts)', async () => {
        // Regression (checklist): even a correctly-signed datagram must be
        // rejected once outside the replay window.
        const secret = 'shared-secret'
        const b = new UdpGossipTransport({
            port: 0,
            bindHost: LOCAL,
            advertiseHost: LOCAL,
            secret,
            replayWindowMs: 1000,
        })
        cleanup.push(b)
        await b.listen()
        const delivered: GossipMessage[] = []
        b.onReceive((m) => delivered.push(m))

        // Hand-craft the authenticated wire: [mac(32)] [ts(8)] [json], with a ts
        // far in the past. MAC is valid (computed with the shared secret).
        const json = Buffer.from(JSON.stringify({ from: 'evil', members: [] }))
        const ts = Buffer.allocUnsafe(8)
        ts.writeDoubleBE(Date.now() - 60_000, 0) // 60s old, window is 1s
        const signed = Buffer.concat([ts, json])
        const mac = createHmac('sha256', Buffer.from(secret)).update(signed).digest()
        const wire = Buffer.concat([mac, signed])

        const raw = dgram.createSocket('udp4')
        const port = Number(b.address.split(':')[1])
        await new Promise<void>((res) => raw.send(wire, port, LOCAL, () => res()))
        raw.close()
        await sleep(50)

        expect(delivered).toHaveLength(0) // stale → dropped despite valid MAC
    })

    it('drops malformed and invalid datagrams but still delivers valid ones', async () => {
        const a = transport()
        const b = transport()
        cleanup.push(a, b)
        await a.listen()
        await b.listen()

        const received: GossipMessage[] = []
        b.onReceive((m) => received.push(m))

        const dgram = await import('node:dgram')
        const raw = dgram.createSocket('udp4')
        const port = Number(b.address.split(':')[1])
        const sendRaw = (buf: Buffer) =>
            new Promise<void>((res) => raw.send(buf, port, LOCAL, () => res()))

        await sendRaw(Buffer.from('not json{'))
        await sendRaw(
            Buffer.from(JSON.stringify({ from: 'x', members: [{ id: 'v', incarnation: '99' }] })),
        )
        await sendRaw(Buffer.from(JSON.stringify({ from: 'x', members: 'nope' })))
        raw.close()

        const valid: GossipMessage = {
            from: 'a',
            members: [{ id: 'a', incarnation: 1, alive: true }],
        }
        a.send(b.address, valid)
        await sleep(50)

        expect(received).toHaveLength(1)
        expect(received[0]).toEqual(valid)
    })

    it('drops a datagram larger than the UDP limit', async () => {
        const a = transport()
        const b = transport()
        cleanup.push(a, b)
        await a.listen()
        await b.listen()

        let got = false
        b.onReceive(() => {
            got = true
        })
        const huge: GossipMessage = {
            from: 'a',
            members: Array.from({ length: 5000 }, (_, i) => ({
                id: `node-${i}`,
                address: `10.0.0.${i}:7946`,
                metadata: { region: 'us-east', capacity: '4000' },
                incarnation: i,
                alive: true,
            })),
        }
        a.send(b.address, huge)
        await sleep(50)
        expect(got).toBe(false)
    })
})

describe('UdpGossipTransport — end-to-end gossip over real UDP', () => {
    it('two GossipMembership nodes converge across the network', async () => {
        const ta = new UdpGossipTransport({ port: 0, bindHost: LOCAL, advertiseHost: LOCAL })
        const tb = new UdpGossipTransport({ port: 0, bindHost: LOCAL, advertiseHost: LOCAL })
        await ta.listen()
        await tb.listen()

        const a = new GossipMembership({ id: 'a', address: ta.address }, ta, {
            gossipIntervalMs: 50,
            deadTimeoutMs: 1000,
        })
        const b = new GossipMembership({ id: 'b', address: tb.address }, tb, {
            seeds: [ta.address],
            gossipIntervalMs: 50,
            deadTimeoutMs: 1000,
        })
        a.start()
        b.start()

        let ok = false
        try {
            const converged = async (): Promise<boolean> => {
                const ids = (await a.list()).map((n) => n.id).sort()
                const idsB = (await b.list()).map((n) => n.id).sort()
                return ids.join() === 'a,b' && idsB.join() === 'a,b'
            }
            for (let i = 0; i < 40 && !ok; i++) {
                ok = await converged()
                if (!ok) await sleep(50)
            }
        } finally {
            a.stop()
            b.stop()
            ta.close()
            tb.close()
        }
        expect(ok).toBe(true)
    })
})
