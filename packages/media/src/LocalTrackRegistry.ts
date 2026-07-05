import type { MediaKind } from 'rtcforge-core'

/**
 * A local {@link MediaStreamTrack} paired with the {@link MediaStream} it belongs to.
 */
export interface LocalTrackEntry {
    /** The individual audio or video track. */
    track: MediaStreamTrack
    /** The stream the track was published as part of. */
    stream: MediaStream
}

/**
 * Tracks the local media tracks a peer is publishing, each with its owning stream.
 *
 * @remarks
 * Seeded optionally from an initial {@link MediaStream} (its tracks are recorded
 * against that stream) and exposes an immutable snapshot via
 * {@link LocalTrackRegistry.entries | entries}, so callers can enumerate what the
 * local peer is sending without mutating internal state.
 */
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

    /** Stop every registered track (turns off the camera/mic), then clear. */
    stopAll(): void {
        for (const { track } of this._tracks) {
            try {
                track.stop()
            } catch {
                // already stopped
            }
        }
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
