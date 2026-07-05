// biome-ignore lint/suspicious/noExplicitAny: internal listener storage requires any
type AnyListener = (...args: any[]) => void

interface Registration {
    readonly listener: AnyListener
    readonly invoke: AnyListener
}

/**
 * A lightweight, type-safe event emitter.
 *
 * The `Events` type parameter maps each event name to the tuple of argument types its
 * listeners receive, so {@link EventEmitter.on | on}, {@link EventEmitter.once | once},
 * {@link EventEmitter.off | off}, and {@link EventEmitter.emit | emit} are all checked
 * against that map at compile time.
 *
 * @typeParam Events - Record mapping each event name to the tuple of arguments passed to its listeners.
 *
 * @remarks
 * Listeners registered for the same event fire in registration order. During `emit` the
 * listener list is snapshotted, so adding or removing listeners inside a handler does not
 * affect the current dispatch. All mutating methods return `this` for chaining.
 *
 * @example
 * ```ts
 * const bus = new EventEmitter<{ ready: []; data: [payload: string] }>()
 * bus.on('data', (payload) => console.log(payload))
 * bus.once('ready', () => console.log('ready once'))
 * bus.emit('ready')
 * bus.emit('data', 'hello')
 * ```
 */
export class EventEmitter<Events extends Record<string, unknown[]>> {
    private readonly _events = new Map<string, Registration[]>()

    /**
     * Registers a listener that is invoked every time `event` is emitted.
     *
     * @param event - The event name to listen for.
     * @param listener - Callback invoked with the event's argument tuple.
     * @returns This emitter, for chaining.
     */
    on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        this._add(String(event), listener as AnyListener, listener as AnyListener)
        return this
    }

    /**
     * Registers a listener that is invoked at most once: it is removed automatically before
     * being called the first time `event` is emitted.
     *
     * @param event - The event name to listen for.
     * @param listener - Callback invoked with the event's argument tuple on the next emission.
     * @returns This emitter, for chaining.
     * @remarks Remove a pending one-time listener by passing the same function reference to {@link EventEmitter.off | off}.
     */
    once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        const invoke = (...args: Events[K]) => {
            this.off(event, listener)
            listener(...args)
        }
        this._add(String(event), listener as AnyListener, invoke as AnyListener)
        return this
    }

    /**
     * Removes a previously registered listener for `event`.
     *
     * @param event - The event name the listener was registered for.
     * @param listener - The exact function reference passed to {@link EventEmitter.on | on} or {@link EventEmitter.once | once}.
     * @returns This emitter, for chaining.
     * @remarks If the listener is not currently registered, this is a no-op. Only the first matching registration is removed.
     */
    off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        const key = String(event)
        const arr = this._events.get(key)
        if (arr) {
            const idx = arr.findIndex((r) => r.listener === (listener as AnyListener))
            if (idx !== -1) {
                arr.splice(idx, 1)
                if (arr.length === 0) this._events.delete(key)
            }
        }
        return this
    }

    /**
     * Synchronously invokes every listener registered for `event`, in registration order.
     *
     * @param event - The event name to emit.
     * @param args - The argument tuple to pass to each listener, matching `Events[event]`.
     * @returns `true` if at least one listener was invoked, `false` if there were none.
     * @remarks The listener list is snapshotted before dispatch, so mutations made by handlers take effect only on subsequent emissions. Listeners are isolated: if one throws, the remaining listeners still run and the error is surfaced via `console.error` rather than swallowed silently (consistent with `LocalMessageBus`).
     */
    emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
        const arr = this._events.get(String(event))
        if (!arr || arr.length === 0) return false
        for (const reg of arr.slice()) {
            try {
                reg.invoke(...args)
            } catch (err) {
                // Isolate listeners: one throwing handler must not abort delivery
                // to the rest. Surface the error instead of swallowing it.
                console.error(`[rtcforge] EventEmitter listener threw on '${String(event)}'`, err)
            }
        }
        return true
    }

    /**
     * Removes listeners for a single event, or for all events.
     *
     * @param event - The event name to clear; if omitted, listeners for every event are removed.
     * @returns This emitter, for chaining.
     */
    removeAllListeners(event?: keyof Events): this {
        if (event !== undefined) this._events.delete(String(event))
        else this._events.clear()
        return this
    }

    /**
     * Returns the number of listeners currently registered for `event`.
     *
     * @param event - The event name to count listeners for.
     * @returns The count of registered listeners (`0` if none).
     */
    listenerCount<K extends keyof Events>(event: K): number {
        return this._events.get(String(event))?.length ?? 0
    }

    private _add(key: string, listener: AnyListener, invoke: AnyListener): void {
        let arr = this._events.get(key)
        if (!arr) {
            arr = []
            this._events.set(key, arr)
        }
        arr.push({ listener, invoke })
    }
}
