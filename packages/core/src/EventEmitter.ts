// biome-ignore lint/suspicious/noExplicitAny: internal listener storage requires any
type AnyListener = (...args: any[]) => void

interface Registration {
    readonly listener: AnyListener
    readonly invoke: AnyListener
}

export class EventEmitter<Events extends Record<string, unknown[]>> {
    private readonly _events = new Map<string, Registration[]>()

    on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        this._add(String(event), listener as AnyListener, listener as AnyListener)
        return this
    }

    once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
        const invoke = (...args: Events[K]) => {
            this.off(event, listener)
            listener(...args)
        }
        this._add(String(event), listener as AnyListener, invoke as AnyListener)
        return this
    }

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

    emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
        const arr = this._events.get(String(event))
        if (!arr || arr.length === 0) return false
        for (const reg of arr.slice()) reg.invoke(...args)
        return true
    }

    removeAllListeners(event?: keyof Events): this {
        if (event !== undefined) this._events.delete(String(event))
        else this._events.clear()
        return this
    }

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
