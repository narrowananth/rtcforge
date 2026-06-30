export interface MessageQueue<T> {
    readonly size: number
    enqueue(item: T): boolean
    drain(send: (item: T) => void): void
    clear(): void
}

export class SendQueue<T> implements MessageQueue<T> {
    private readonly _items: T[] = []

    constructor(private readonly maxSize: number) {}

    get size(): number {
        return this._items.length
    }

    enqueue(item: T): boolean {
        if (this._items.length >= this.maxSize) return false
        this._items.push(item)
        return true
    }

    drain(send: (item: T) => void): void {
        while (this._items.length > 0) {
            send(this._items[0])
            this._items.shift()
        }
    }

    clear(): void {
        this._items.length = 0
    }
}
