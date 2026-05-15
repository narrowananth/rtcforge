// biome-ignore lint/suspicious/noExplicitAny: internal listener storage requires any
type AnyListener = (...args: any[]) => void

export class EventEmitter<Events extends Record<string, unknown[]>> {
    private readonly _listeners = new Map<string, AnyListener[]>()

    on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        const key = String(event)
        const arr = this._listeners.get(key) ?? []
        arr.push(listener)
        this._listeners.set(key, arr)
        return this
    }

    once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        const wrappedListener = (...args: Events[K]) => {
            this.off(event, wrappedListener)
            listener(...args)
        }
        return this.on(event, wrappedListener)
    }

    off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        const key = String(event)
        const arr = this._listeners.get(key)
        if (arr) {
            const idx = arr.indexOf(listener)
            if (idx !== -1) arr.splice(idx, 1)
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
            this._listeners.delete(String(event))
        } else {
            this._listeners.clear()
        }
        return this
    }
}
