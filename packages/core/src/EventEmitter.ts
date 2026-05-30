// biome-ignore lint/suspicious/noExplicitAny: internal listener storage requires any
type AnyListener = (...args: any[]) => void

export class EventEmitter<Events extends Record<string, unknown[]>> {
    private readonly _listeners = new Map<string, AnyListener[]>()
    private readonly _onceWrappers = new Map<string, Map<AnyListener, AnyListener>>()

    on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        const key = String(event)
        let arr = this._listeners.get(key)
        if (!arr) {
            arr = []
            this._listeners.set(key, arr)
        }
        arr.push(listener as AnyListener)
        return this
    }

    once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        const key = String(event)
        const wrappedListener = (...args: Events[K]) => {
            this.off(event, listener)
            listener(...args)
        }
        let keyMap = this._onceWrappers.get(key)
        if (!keyMap) {
            keyMap = new Map<AnyListener, AnyListener>()
            this._onceWrappers.set(key, keyMap)
        }
        keyMap.set(listener as AnyListener, wrappedListener as AnyListener)
        return this.on(event, wrappedListener)
    }

    off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        const key = String(event)
        const arr = this._listeners.get(key)
        if (arr) {
            const keyMap = this._onceWrappers.get(key)
            const wrapper = keyMap?.get(listener as AnyListener)
            const toRemove = wrapper ?? (listener as AnyListener)
            const idx = arr.indexOf(toRemove)
            if (idx !== -1) {
                arr.splice(idx, 1)
                if (wrapper) {
                    keyMap?.delete(listener as AnyListener)
                    if (keyMap?.size === 0) this._onceWrappers.delete(key)
                }
            }
        }
        return this
    }

    emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
        const key = String(event)
        const arr = this._listeners.get(key)
        if (!arr || arr.length === 0) return false
        for (const listener of arr.slice()) listener(...args)
        return true
    }

    removeAllListeners(event?: keyof Events): this {
        if (event !== undefined) {
            const key = String(event)
            this._listeners.delete(key)
            this._onceWrappers.delete(key)
        } else {
            this._listeners.clear()
            this._onceWrappers.clear()
        }
        return this
    }

    listenerCount<K extends keyof Events>(event: K): number {
        return this._listeners.get(String(event))?.length ?? 0
    }
}
