import type { Room } from '@rtcforge/signaling'
import { RoomEvent } from '@rtcforge/signaling'
import { StreamingSession } from './StreamingSession.js'
import { noopLogger } from './types.js'
import type { Logger, StreamingServiceOptions, StreamingSessionOptions } from './types.js'

export class StreamingService {
    private readonly _logger: Logger
    private readonly _sessions = new Set<StreamingSession>()

    constructor(options: StreamingServiceOptions = {}) {
        this._logger = options.logger ?? noopLogger
    }

    startSession(room: Room, options: StreamingSessionOptions): StreamingSession {
        if (!room.getPeer(options.hostPeerId)) {
            throw new Error(`Host peer not found in room: ${options.hostPeerId}`)
        }

        const session = new StreamingSession(room, {
            ...options,
            logger: options.logger ?? this._logger,
        })

        this._sessions.add(session)
        room.once(RoomEvent.Closed, () => this._sessions.delete(session))
        this._logger.info('Streaming session created', {
            hostPeerId: options.hostPeerId,
            sessionCount: this._sessions.size,
        })
        return session
    }

    get sessionCount(): number {
        return this._sessions.size
    }

    stopAll(): void {
        for (const s of this._sessions) s.stop()
        this._sessions.clear()
    }
}
