import type { SfuNode } from './SfuNode.js'

export interface HealthCheckerDeps {
    nodes: () => Iterable<SfuNode>
    stillRegistered: (nodeId: string) => boolean
    onCheck: (nodeId: string) => Promise<boolean>
    onResult: (node: SfuNode, healthy: boolean) => void
    intervalMs: number
}

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
                        const healthy = await this.deps.onCheck(node.id)
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
}
