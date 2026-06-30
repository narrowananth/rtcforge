import type { EventEmitter } from 'rtcforge-core'
import type { ClientMessage, ServerMessage } from './protocol.js'
import { TransportEvent } from './types.js'

export type TransportEvents = {
    [TransportEvent.Open]: []
    [TransportEvent.Close]: [code: number, reason: string]
    [TransportEvent.Message]: [data: ServerMessage]
    [TransportEvent.Error]: [err: Error]
    [TransportEvent.Reconnecting]: [attempt: number]
}

export interface Transport extends Pick<EventEmitter<TransportEvents>, 'on' | 'once' | 'off'> {
    connect(): Promise<void>
    send(msg: ClientMessage): void
    flush(): void
    close(): void
}
