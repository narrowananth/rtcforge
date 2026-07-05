import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from '../src/EventEmitter.js'

type TestEvents = {
    data: [value: string]
    count: [n: number]
    empty: []
}

describe('EventEmitter', () => {
    it('on: listener receives emitted args', () => {
        const ee = new EventEmitter<TestEvents>()
        const listener = vi.fn()
        ee.on('data', listener)
        ee.emit('data', 'hello')
        expect(listener).toHaveBeenCalledWith('hello')
    })

    it('on: multiple listeners all called', () => {
        const ee = new EventEmitter<TestEvents>()
        const a = vi.fn()
        const b = vi.fn()
        ee.on('data', a)
        ee.on('data', b)
        ee.emit('data', 'x')
        expect(a).toHaveBeenCalled()
        expect(b).toHaveBeenCalled()
    })

    it('off: removes listener', () => {
        const ee = new EventEmitter<TestEvents>()
        const listener = vi.fn()
        ee.on('data', listener)
        ee.off('data', listener)
        ee.emit('data', 'x')
        expect(listener).not.toHaveBeenCalled()
    })

    it('once: fires only once', () => {
        const ee = new EventEmitter<TestEvents>()
        const listener = vi.fn()
        ee.once('data', listener)
        ee.emit('data', 'first')
        ee.emit('data', 'second')
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith('first')
    })

    it('emit: returns false when no listeners', () => {
        const ee = new EventEmitter<TestEvents>()
        expect(ee.emit('data', 'x')).toBe(false)
    })

    it('emit: returns true when listeners exist', () => {
        const ee = new EventEmitter<TestEvents>()
        ee.on('data', vi.fn())
        expect(ee.emit('data', 'x')).toBe(true)
    })

    it('removeAllListeners: clears all listeners for event', () => {
        const ee = new EventEmitter<TestEvents>()
        const a = vi.fn()
        const b = vi.fn()
        ee.on('data', a)
        ee.on('count', b)
        ee.removeAllListeners('data')
        ee.emit('data', 'x')
        ee.emit('count', 1)
        expect(a).not.toHaveBeenCalled()
        expect(b).toHaveBeenCalled()
    })

    it('removeAllListeners: with no arg clears all events', () => {
        const ee = new EventEmitter<TestEvents>()
        const a = vi.fn()
        const b = vi.fn()
        ee.on('data', a)
        ee.on('count', b)
        ee.removeAllListeners()
        ee.emit('data', 'x')
        ee.emit('count', 1)
        expect(a).not.toHaveBeenCalled()
        expect(b).not.toHaveBeenCalled()
    })

    it('on: returns this for chaining', () => {
        const ee = new EventEmitter<TestEvents>()
        expect(ee.on('data', vi.fn())).toBe(ee)
    })

    it('off: no-op when listener was not registered', () => {
        const ee = new EventEmitter<TestEvents>()
        const listener = vi.fn()
        expect(() => ee.off('data', listener)).not.toThrow()
    })

    it('once: off(event, originalListener) cancels before firing', () => {
        const ee = new EventEmitter<TestEvents>()
        const listener = vi.fn()
        ee.once('data', listener)
        ee.off('data', listener)
        ee.emit('data', 'x')
        expect(listener).not.toHaveBeenCalled()
    })

    it('listenerCount: returns 0 with no listeners', () => {
        const ee = new EventEmitter<TestEvents>()
        expect(ee.listenerCount('data')).toBe(0)
    })

    it('listenerCount: counts registered listeners including once', () => {
        const ee = new EventEmitter<TestEvents>()
        ee.on('data', vi.fn())
        ee.once('data', vi.fn())
        expect(ee.listenerCount('data')).toBe(2)
    })

    it('listenerCount: decrements after once fires', () => {
        const ee = new EventEmitter<TestEvents>()
        ee.once('data', vi.fn())
        expect(ee.listenerCount('data')).toBe(1)
        ee.emit('data', 'x')
        expect(ee.listenerCount('data')).toBe(0)
    })

    it('emit: a throwing listener does not abort delivery to the rest', () => {
        const ee = new EventEmitter<TestEvents>()
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const before = vi.fn()
        const throwing = vi.fn(() => {
            throw new Error('boom')
        })
        const after = vi.fn()
        ee.on('data', before)
        ee.on('data', throwing)
        ee.on('data', after)

        expect(ee.emit('data', 'x')).toBe(true)
        expect(before).toHaveBeenCalledWith('x')
        expect(throwing).toHaveBeenCalled()
        expect(after).toHaveBeenCalledWith('x') // not aborted by the throw
        expect(errSpy).toHaveBeenCalled() // error surfaced, not swallowed
        errSpy.mockRestore()
    })
})
