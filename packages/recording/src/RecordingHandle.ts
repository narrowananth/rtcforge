import { EventEmitter } from '@rtcforge/core'
import { RecordingEvent, RecordingState, noopLogger } from './types.js'
import type { Logger, RecordingCompleteEvent, RecordingOptions } from './types.js'

type RecordingHandleEvents = {
    [RecordingEvent.Data]: [chunk: Blob]
    [RecordingEvent.Complete]: [event: RecordingCompleteEvent]
    [RecordingEvent.Error]: [error: Error]
    [RecordingEvent.Pause]: []
    [RecordingEvent.Resume]: []
}

export class RecordingHandle extends EventEmitter<RecordingHandleEvents> {
    private readonly _recorder: MediaRecorder
    private readonly _chunks: Blob[] = []
    private _state: RecordingState = RecordingState.Recording
    private readonly _startTime: number
    private _pauseStart: number | null = null
    private _totalPausedMs = 0
    private readonly _logger: Logger

    constructor(stream: MediaStream, options: RecordingOptions = {}) {
        super()
        this._logger = options.logger ?? noopLogger
        this._startTime = Date.now()

        if (options.mimeType && !MediaRecorder.isTypeSupported(options.mimeType)) {
            throw new Error(`MIME type not supported: ${options.mimeType}`)
        }

        const recOpts: MediaRecorderOptions = {}
        if (options.mimeType) recOpts.mimeType = options.mimeType
        if (options.bitsPerSecond !== undefined) recOpts.bitsPerSecond = options.bitsPerSecond
        if (options.videoBitsPerSecond !== undefined)
            recOpts.videoBitsPerSecond = options.videoBitsPerSecond
        if (options.audioBitsPerSecond !== undefined)
            recOpts.audioBitsPerSecond = options.audioBitsPerSecond

        this._recorder = new MediaRecorder(stream, recOpts)

        this._recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this._chunks.push(event.data)
                this.emit(RecordingEvent.Data, event.data)
                this._logger.debug('Recording chunk', { size: event.data.size })
            }
        }

        this._recorder.onerror = (event) => {
            const err =
                (event as Event & { error?: DOMException }).error ??
                new Error('MediaRecorder error')
            this._logger.error('Recording error', { error: err.message })
            this.emit(RecordingEvent.Error, err)
        }

        const trackCleanups: (() => void)[] = []
        for (const track of stream.getTracks()) {
            const onEnded = () => {
                if (this._state !== RecordingState.Stopped) {
                    this._logger.info('Stream track ended — stopping recording')
                    this._recorder.stop()
                }
            }
            track.addEventListener('ended', onEnded)
            trackCleanups.push(() => track.removeEventListener('ended', onEnded))
        }

        this._recorder.onstop = () => {
            for (const cleanup of trackCleanups) cleanup()
            // If stopped while paused, account for the open pause interval
            if (this._pauseStart !== null) {
                this._totalPausedMs += Date.now() - this._pauseStart
                this._pauseStart = null
            }
            const duration = Date.now() - this._startTime - this._totalPausedMs
            const mimeType = this._recorder.mimeType
            const blob = new Blob(this._chunks, { type: mimeType })
            this._state = RecordingState.Stopped
            this._logger.info('Recording complete', { duration, size: blob.size })
            this.emit(RecordingEvent.Complete, { blob, duration, mimeType })
        }

        this._recorder.onpause = () => {
            this._pauseStart = Date.now()
            this._state = RecordingState.Paused
            this._logger.debug('Recording paused')
            this.emit(RecordingEvent.Pause)
        }

        this._recorder.onresume = () => {
            if (this._pauseStart !== null) {
                this._totalPausedMs += Date.now() - this._pauseStart
                this._pauseStart = null
            }
            this._state = RecordingState.Recording
            this._logger.debug('Recording resumed')
            this.emit(RecordingEvent.Resume)
        }

        this._recorder.start(options.timeslice)
        this._logger.info('Recording started')
    }

    get state(): RecordingState {
        return this._state
    }

    get mimeType(): string {
        return this._recorder.mimeType
    }

    pause(): void {
        if (this._state !== RecordingState.Recording) return
        this._recorder.pause()
    }

    resume(): void {
        if (this._state !== RecordingState.Paused) return
        this._recorder.resume()
    }

    stop(): Promise<RecordingCompleteEvent> {
        if (this._state === RecordingState.Stopped) {
            return Promise.reject(new Error('Recording already stopped'))
        }
        return new Promise<RecordingCompleteEvent>((resolve, reject) => {
            // Use targeted on/off so we don't nuke user-registered listeners
            let onComplete: ((event: RecordingCompleteEvent) => void) | null = null
            let onError: ((error: Error) => void) | null = null

            const cleanup = () => {
                if (onComplete) this.off(RecordingEvent.Complete, onComplete)
                if (onError) this.off(RecordingEvent.Error, onError)
                onComplete = null
                onError = null
            }

            onComplete = (event) => {
                cleanup()
                resolve(event)
            }
            onError = (error) => {
                cleanup()
                reject(error)
            }

            this.on(RecordingEvent.Complete, onComplete)
            this.on(RecordingEvent.Error, onError)
            this._recorder.stop()
        })
    }
}
