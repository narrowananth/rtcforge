/**
 * Requests camera and/or microphone access, returning the captured
 * {@link MediaStream}. Thin wrapper over `navigator.mediaDevices.getUserMedia`.
 *
 * @param constraints - Media constraints. Defaults to requesting both video and audio.
 * @returns The captured local media stream.
 * @throws A `DOMException` if permission is denied or no matching device exists.
 *
 * @example
 * ```ts
 * const stream = await getUserMedia({ audio: true, video: { width: 1280 } })
 * ```
 */
export function getUserMedia(
    constraints: MediaStreamConstraints = { video: true, audio: true },
): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia(constraints)
}

/**
 * Prompts the user to share a screen, window, or tab. Thin wrapper over
 * `navigator.mediaDevices.getDisplayMedia`.
 *
 * @param constraints - Display capture options (e.g. video/audio, cursor). Defaults to `{}`.
 * @returns The captured display media stream.
 * @throws A `DOMException` if the user cancels or capture is not permitted.
 */
export function getDisplayMedia(constraints: DisplayMediaStreamOptions = {}): Promise<MediaStream> {
    return navigator.mediaDevices.getDisplayMedia(constraints)
}

/**
 * Convenience wrapper over {@link getUserMedia} that exposes common audio
 * processing constraints without the full `MediaStreamConstraints` shape.
 * Audio and video each default to `false` (disabled) when omitted.
 *
 * @param opts - Audio processing flags and/or video constraints.
 * @param opts.audio - Audio capture with optional echo cancellation, noise suppression, auto gain control, and sample rate.
 * @param opts.video - Video constraints, or a boolean to enable/disable video.
 * @returns The captured local media stream.
 *
 * @example
 * ```ts
 * const stream = await getUserMediaWithOptions({
 *   audio: { echoCancellation: true, noiseSuppression: true },
 *   video: true,
 * })
 * ```
 */
export function getUserMediaWithOptions(opts: {
    audio?: {
        echoCancellation?: boolean
        noiseSuppression?: boolean
        autoGainControl?: boolean
        sampleRate?: number
    }
    video?: MediaTrackConstraints | boolean
}): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
        audio: opts.audio ?? false,
        video: opts.video ?? false,
    })
}

/**
 * Lists all available media input and output devices.
 *
 * @returns An array of `MediaDeviceInfo`. Device labels are only populated after
 * media permission has been granted.
 */
export function enumerateDevices(): Promise<MediaDeviceInfo[]> {
    return navigator.mediaDevices.enumerateDevices()
}

/**
 * Lists available audio input (microphone) devices.
 *
 * @returns The subset of {@link enumerateDevices} entries with kind `"audioinput"`.
 */
export async function getAudioDevices(): Promise<MediaDeviceInfo[]> {
    return (await enumerateDevices()).filter((d) => d.kind === 'audioinput')
}

/**
 * Lists available video input (camera) devices.
 *
 * @returns The subset of {@link enumerateDevices} entries with kind `"videoinput"`.
 */
export async function getVideoDevices(): Promise<MediaDeviceInfo[]> {
    return (await enumerateDevices()).filter((d) => d.kind === 'videoinput')
}

/**
 * Subscribes to device add/remove events (e.g. plugging in a headset).
 *
 * @param handler - Callback invoked whenever the device list changes.
 * @returns An unsubscribe function that removes the listener.
 *
 * @example
 * ```ts
 * const off = onDeviceChange(() => refreshDeviceList())
 * // later
 * off()
 * ```
 */
export function onDeviceChange(handler: () => void): () => void {
    navigator.mediaDevices.addEventListener('devicechange', handler)
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler)
}

/**
 * Queries the current camera and microphone permission states via the
 * Permissions API, without prompting the user.
 *
 * @returns An object with the `camera` and `microphone` permission states
 * (`"granted"`, `"denied"`, or `"prompt"`).
 */
export async function checkPermissions(): Promise<{
    camera: PermissionState
    microphone: PermissionState
}> {
    const [cam, mic] = await Promise.all([
        navigator.permissions.query({ name: 'camera' as PermissionName }),
        navigator.permissions.query({ name: 'microphone' as PermissionName }),
    ])
    return { camera: cam.state, microphone: mic.state }
}
