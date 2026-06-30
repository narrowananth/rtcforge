import { GossipMembership } from '@rtcforge/core'
import type { GossipMessage } from '@rtcforge/core'
import { afterEach, describe, expect, it } from 'vitest'
import { UdpGossipTransport } from '../src/UdpGossipTransport.js'

const LOCAL = '127.0.0.1'

function transport(): UdpGossipTransport {
    return new UdpGossipTransport({ port: 0, bindHost: LOCAL, advertiseHost: LOCAL })
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
