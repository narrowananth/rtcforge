import os from 'node:os'
import { EventEmitter, noopLogger } from '@rtcforge/core'
import type { Logger } from '@rtcforge/core'
import * as mediasoup from 'mediasoup'
import type { types as MsTypes } from 'mediasoup'
import type { WorkerSettings } from './types.js'

export const WorkerPoolEvent = {
    Error: 'error',
    WorkerDied: 'worker-died',
} as const

type WorkerPoolEvents = {
    [WorkerPoolEvent.Error]: [err: Error]
    [WorkerPoolEvent.WorkerDied]: [pid: number]
}

export class WorkerPool extends EventEmitter<WorkerPoolEvents> {
    private readonly _load = new Map<MsTypes.Worker, number>()
    private _started = false
    private _starting = false

    constructor(
        private readonly settings: WorkerSettings = {},
        private readonly logger: Logger = noopLogger,
    ) {
        super()
    }

    get size(): number {
        return this._load.size
    }

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
