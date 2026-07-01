import { describe, expect, it } from 'vitest'
import { Sha256Digest, sha256Hex } from '../../src/filetransfer/checksum.js'

// Known vector: SHA-256("abc")
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

const enc = (s: string) => new TextEncoder().encode(s)

describe('checksum', () => {
    it('sha256Hex matches a known vector', async () => {
        expect(await sha256Hex(enc('abc'))).toBe(ABC)
    })

    it('Sha256Digest tag is independent of chunk insertion order', async () => {
        const a = enc('a')
        const b = enc('b')
        const c = enc('c')

        const inOrder = new Sha256Digest()
        await inOrder.update(0, a)
        await inOrder.update(1, b)
        await inOrder.update(2, c)

        const outOfOrder = new Sha256Digest()
        await outOfOrder.update(2, c)
        await outOfOrder.update(0, a)
        await outOfOrder.update(1, b)

        expect(await outOfOrder.finalize()).toBe(await inOrder.finalize())
    })

    it('Sha256Digest tag changes when a chunk differs', async () => {
        const base = new Sha256Digest()
        await base.update(0, enc('a'))
        await base.update(1, enc('b'))

        const altered = new Sha256Digest()
        await altered.update(0, enc('a'))
        await altered.update(1, enc('X'))

        expect(await altered.finalize()).not.toBe(await base.finalize())
    })

    it('empty digest equals SHA-256 of empty input', async () => {
        const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        expect(await new Sha256Digest().finalize()).toBe(empty)
    })
})
