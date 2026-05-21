import { RecordingHandle } from './RecordingHandle.js'
import { RecordingEvent, noopLogger } from './types.js'
import type { Logger, RecordingOptions } from './types.js'

export interface RecordingServiceOptions {
    logger?: Logger
}

export class RecordingService {
    private readonly _logger: Logger
    private readonly _active = new Set<RecordingHandle>()

    constructor(options: RecordingServiceOptions = {}) {
        this._logger = options.logger ?? noopLogger
    }

    start(stream: MediaStream, options: RecordingOptions = {}): RecordingHandle {
        const handle = new RecordingHandle(stream, {
            ...options,
            logger: options.logger ?? this._logger,
        })
        this._active.add(handle)
        const remove = () => this._active.delete(handle)
        handle.once(RecordingEvent.Complete, remove)
        handle.once(RecordingEvent.Error, remove)
        this._logger.info('Recording started', { activeCount: this._active.size })
        return handle
    }

    get activeCount(): number {
        return this._active.size
    }

    async stopAll(): Promise<void> {
        await Promise.allSettled([...this._active].map((h) => h.stop()))
    }

    static isTypeSupported(mimeType: string): boolean {
        return MediaRecorder.isTypeSupported(mimeType)
    }

    static getSupportedMimeTypes(): string[] {
        const candidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4',
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/ogg',
            'audio/mp4',
        ]
        return candidates.filter((t) => MediaRecorder.isTypeSupported(t))
    }
}
