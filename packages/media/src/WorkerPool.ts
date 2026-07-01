import os from 'node:os'
import * as mediasoup from 'mediasoup'
import type { types as MsTypes } from 'mediasoup'
import { EventEmitter, noopLogger } from 'rtcforge-core'
import type { Logger } from 'rtcforge-core'
import type { WorkerSettings } from './types.js'

/**
 * Events emitted by a {@link WorkerPool}.
 */
export const WorkerPoolEvent = {
    /** An error occurred, e.g. respawning a died worker failed. Payload: `(error)`. */
    Error: 'error',
    /** A mediasoup worker subprocess died. Payload: `(pid)`. Routers on it are lost. */
    WorkerDied: 'worker-died',
} as const

type WorkerPoolEvents = {
    [WorkerPoolEvent.Error]: [err: Error]
    [WorkerPoolEvent.WorkerDied]: [pid: number]
}

/**
 * Server-side (mediasoup SFU) pool of worker subprocesses. Spawns one worker per
 * logical CPU (by default), tracks each worker's router load, and assigns new
 * routers to the least-loaded worker. Died workers are respawned automatically
 * while the pool is running.
 *
 * @remarks Node-only; not usable in the browser. Managed internally by {@link MediaService}.
 */
export class WorkerPool extends EventEmitter<WorkerPoolEvents> {
    private readonly _load = new Map<MsTypes.Worker, number>()
    private _started = false
    private _starting = false

    /**
     * @param settings - Worker pool settings (count, log level/tags, RTC port range). Defaults to `{}`.
     * @param logger - Logger for diagnostics. Defaults to a no-op logger.
     */
    constructor(
        private readonly settings: WorkerSettings = {},
        private readonly logger: Logger = noopLogger,
    ) {
        super()
    }

    /** Number of live workers in the pool. */
    get size(): number {
        return this._load.size
    }

    /**
     * Spawns the configured number of workers. Idempotent and safe against
     * concurrent calls; returns once all workers are ready.
     */
    async start(): Promise<void> {
        if (this._started || this._starting) return

        this._starting = true
        try {
            const count = this.settings.numWorkers ?? os.cpus().length
            await Promise.all(Array.from({ length: count }, () => this._spawn()))
            this._started = true
            this.logger.info('Worker pool started', { workers: this._load.size })
        } finally {
            this._starting = false
        }
    }

    /**
     * Creates a mediasoup router on the least-loaded worker, incrementing that
     * worker's load and decrementing it when the router closes.
     *
     * @param options - mediasoup router options (media codecs).
     * @returns The created mediasoup `Router`.
     * @throws If the pool has not been started, or if it has no workers.
     */
    async createRouter(options: MsTypes.RouterOptions): Promise<MsTypes.Router> {
        if (!this._started) throw new Error('WorkerPool not started — call start() first')
        const worker = this._leastLoaded()
        const router = await worker.createRouter(options)
        this._load.set(worker, (this._load.get(worker) ?? 0) + 1)
        router.observer.once('close', () => {
            const current = this._load.get(worker)
            if (current !== undefined) this._load.set(worker, Math.max(0, current - 1))
        })
        return router
    }

    /** Closes all workers and empties the pool. Respawning is disabled once closed. */
    async close(): Promise<void> {
        for (const worker of this._load.keys()) worker.close()
        this._load.clear()
        this._started = false
    }

    private _leastLoaded(): MsTypes.Worker {
        let best: MsTypes.Worker | undefined
        let min = Number.POSITIVE_INFINITY
        for (const [worker, load] of this._load) {
            if (load < min) {
                min = load
                best = worker
            }
        }
        if (!best) throw new Error('WorkerPool has no workers')
        return best
    }

    private async _spawn(): Promise<MsTypes.Worker> {
        const worker = await mediasoup.createWorker({
            logLevel: this.settings.logLevel ?? 'warn',
            logTags: this.settings.logTags,
            rtcMinPort: this.settings.rtcMinPort,
            rtcMaxPort: this.settings.rtcMaxPort,
        })
        this._load.set(worker, 0)
        worker.on('died', () => {
            this.logger.error('mediasoup worker died', { pid: worker.pid })
            this._load.delete(worker)
            this.emit(WorkerPoolEvent.WorkerDied, worker.pid)
            if (this._started) {
                this._spawn().catch((err: Error) => this.emit(WorkerPoolEvent.Error, err))
            }
        })
        return worker
    }
}
