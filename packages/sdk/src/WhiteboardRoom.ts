import { EventEmitter } from './EventEmitter.js'

type WhiteboardRoomEvents = {
    event: [data: unknown]
}

// Stub for Phase 7 — event interface is stable, implementation pending.
export class WhiteboardRoom extends EventEmitter<WhiteboardRoomEvents> {
    emit(event: 'event', data: unknown): boolean {
        return super.emit(event, data)
    }

    // biome-ignore lint/suspicious/noExplicitAny: public stub API
    send(_data: any): void {
        // no-op until Phase 7
    }
}
