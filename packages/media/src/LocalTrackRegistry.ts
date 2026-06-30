import type { MediaKind } from 'rtcforge-core'

export interface LocalTrackEntry {
    track: MediaStreamTrack
    stream: MediaStream
}

export class LocalTrackRegistry {
    private readonly _tracks: LocalTrackEntry[] = []

    constructor(initial?: MediaStream) {
        if (initial) {
            for (const track of initial.getTracks()) this._tracks.push({ track, stream: initial })
        }
    }

    get entries(): readonly LocalTrackEntry[] {
        return [...this._tracks]
    }

    add(track: MediaStreamTrack, stream: MediaStream): void {
        this._tracks.push({ track, stream })
    }

    remove(track: MediaStreamTrack): void {
        const idx = this._tracks.findIndex((e) => e.track === track)
        if (idx !== -1) this._tracks.splice(idx, 1)
    }

    replace(oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack): void {
        const idx = this._tracks.findIndex((e) => e.track === oldTrack)
        if (idx !== -1) this._tracks[idx] = { track: newTrack, stream: this._tracks[idx].stream }
    }

    clear(): void {
        this._tracks.length = 0
    }

    setKindEnabled(kind: MediaKind, enabled: boolean): void {
        for (const { track } of this._tracks) {
            if (track.kind === kind) track.enabled = enabled
        }
    }

    isKindMuted(kind: MediaKind): boolean {
        let found = false
        let allMuted = true
        for (const { track } of this._tracks) {
            if (track.kind === kind) {
                found = true
                if (track.enabled) allMuted = false
            }
        }
        return found && allMuted
    }
}
