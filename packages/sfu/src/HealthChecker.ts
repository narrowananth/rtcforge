import type { SfuNode } from './SfuNode.js'

export interface HealthCheckerDeps {
    nodes: () => Iterable<SfuNode>
    stillRegistered: (nodeId: string) => boolean
    onCheck: (nodeId: string) => Promise<boolean>
    onResult: (node: SfuNode, healthy: boolean) => void
    intervalMs: number
    /**
     * Milliseconds a single probe may run before it is treated as a failure.
     * Prevents a hung `onCheck` from leaving the node permanently in-flight and
     * never re-checked. Defaults to {@link HealthCheckerDeps.intervalMs}.
     */
    probeTimeoutMs?: number
}

/**
 * Periodically probes every registered {@link SfuNode} for liveness and reports
 * each result back to the cluster.
 *
 * @remarks
 * On a fixed interval it runs the injected `onCheck` probe for each non-draining
 * node, deduping in-flight probes and racing each against a timeout so a hung
 * probe cannot wedge a node out of future sweeps. Results are delivered via
 * `onResult`; the {@link SfuCluster} applies a consecutive-failure threshold on
 * top so a single transient failure does not trigger a migration storm. The
 * interval timer is `unref`'d, so it never keeps the process alive on its own.
 */
export class HealthChecker {
    private _timer: ReturnType<typeof setInterval> | null = null
    private _running = false
    private readonly _inFlight = new Set<string>()

    constructor(private readonly deps: HealthCheckerDeps) {}

    start(): void {
        if (this._timer !== null) return
        this._running = true
        this._timer = setInterval(() => this._tick(), this.deps.intervalMs)
        this._timer.unref()
    }

    stop(): void {
        this._running = false
        if (this._timer !== null) {
            clearInterval(this._timer)
            this._timer = null
        }
    }

    private _tick(): void {
        const checks: Promise<void>[] = []
        for (const node of this.deps.nodes()) {
            if (node.isDraining || this._inFlight.has(node.id)) continue
            checks.push(
                (async () => {
                    this._inFlight.add(node.id)
                    try {
                        const healthy = await this._probe(node.id)
                        if (!this._running || !this.deps.stillRegistered(node.id)) return
                        this.deps.onResult(node, healthy)
                    } catch {
                        if (!this._running || !this.deps.stillRegistered(node.id)) return
                        this.deps.onResult(node, false)
                    } finally {
                        this._inFlight.delete(node.id)
                    }
                })(),
            )
        }
        void Promise.allSettled(checks)
    }

    // Race the probe against a timeout so a never-settling onCheck is treated as
    // a failure (rejects) rather than pinning the node's id in _inFlight forever.
    private _probe(nodeId: string): Promise<boolean> {
        const timeoutMs = this.deps.probeTimeoutMs ?? this.deps.intervalMs
        if (!(timeoutMs > 0)) return this.deps.onCheck(nodeId)
        return new Promise<boolean>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('health probe timed out')), timeoutMs)
            if (typeof (timer as { unref?: () => void }).unref === 'function') {
                ;(timer as { unref: () => void }).unref()
            }
            this.deps.onCheck(nodeId).then(
                (healthy) => {
                    clearTimeout(timer)
                    resolve(healthy)
                },
                (err) => {
                    clearTimeout(timer)
                    reject(err)
                },
            )
        })
    }
}
