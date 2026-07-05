import { describe, expect, it } from 'vitest'
import { SendQueue } from '../src/SendQueue.js'

describe('SendQueue', () => {
    it('enqueues up to maxSize then rejects', () => {
        const q = new SendQueue<number>(2)
        expect(q.enqueue(1)).toBe(true)
        expect(q.enqueue(2)).toBe(true)
        expect(q.enqueue(3)).toBe(false)
        expect(q.size).toBe(2)
    })

    it('drains all items in FIFO order and empties the queue', () => {
        const q = new SendQueue<number>(10)
        q.enqueue(1)
        q.enqueue(2)
        q.enqueue(3)
        const sent: number[] = []
        q.drain((n) => sent.push(n))
        expect(sent).toEqual([1, 2, 3])
        expect(q.size).toBe(0)
    })

    it('does not let a send exception escape drain and re-queues the unsent tail', () => {
        const q = new SendQueue<number>(10)
        q.enqueue(1)
        q.enqueue(2)
        q.enqueue(3)
        const sent: number[] = []
        expect(() =>
            q.drain((n) => {
                if (n === 2) throw new Error('boom')
                sent.push(n)
            }),
        ).not.toThrow()
        // Only the head before the failure was sent.
        expect(sent).toEqual([1])
        // The failed item and the remaining item stay queued in FIFO order.
        const rest: number[] = []
        q.drain((n) => rest.push(n))
        expect(rest).toEqual([2, 3])
    })

    it('keeps FIFO order when items are enqueued re-entrantly during a failed drain', () => {
        const q = new SendQueue<number>(10)
        q.enqueue(1)
        q.enqueue(2)
        q.drain((n) => {
            if (n === 2) {
                q.enqueue(99)
                throw new Error('boom')
            }
        })
        const rest: number[] = []
        q.drain((n) => rest.push(n))
        // Re-queued failed item (2) precedes the re-entrantly enqueued item (99).
        expect(rest).toEqual([2, 99])
    })
})
