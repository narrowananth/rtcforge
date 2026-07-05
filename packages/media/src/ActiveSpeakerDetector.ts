interface StatsSource {
    getStats(): Promise<RTCStatsReport>
}

/**
 * Polls per-peer audio levels and reports which peer is currently speaking.
 *
 * @remarks
 * On {@link ActiveSpeakerDetector.start | start} it samples each connection's
 * `getStats()` every `intervalMs`, reads the inbound audio level, and invokes
 * `onChange` whenever the loudest peer (or silence, `null`) changes — not on every
 * tick. Overlapping ticks are guarded and the timer is `unref`'d so it never keeps
 * the process alive. Call {@link ActiveSpeakerDetector.stop | stop} to halt and
 * clear the current speaker.
 */
export class ActiveSpeakerDetector {
    private _timer: ReturnType<typeof setInterval> | null = null
    private _current: string | null = null
    private _ticking = false

    constructor(
        private readonly connections: () => Iterable<[string, StatsSource]>,
        private readonly onChange: (peerId: string | null, audioLevel: number) => void,
        private readonly intervalMs = 1000,
    ) {}

    start(): void {
        if (this._timer !== null) return
        this._timer = setInterval(() => void this._tick(), this.intervalMs)
        this._timer.unref?.()
    }

    stop(): void {
        if (this._timer !== null) {
            clearInterval(this._timer)
            this._timer = null
        }
        this._current = null
    }

    private async _tick(): Promise<void> {
        if (this._ticking) return
        this._ticking = true
        try {
            await this._detect()
        } finally {
            this._ticking = false
        }
    }

    private async _detect(): Promise<void> {
        const results = await Promise.all(
            Array.from(this.connections(), async ([peerId, source]) => {
                try {
                    const stats = await source.getStats()
                    let maxLevel = 0
                    for (const report of stats.values()) {
                        if (report.type === 'inbound-rtp') {
                            const level = (report as { audioLevel?: unknown }).audioLevel
                            if (typeof level === 'number' && level > maxLevel) maxLevel = level
                        }
                    }
                    return { peerId, level: maxLevel }
                } catch {
                    return null
                }
            }),
        )

        let maxLevel = 0
        let speaker: string | null = null
        for (const r of results) {
            if (r && r.level > maxLevel) {
                maxLevel = r.level
                speaker = r.peerId
            }
        }
        if (speaker !== this._current) {
            this._current = speaker
            this.onChange(speaker, maxLevel)
        }
    }
}
