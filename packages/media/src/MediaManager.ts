export function getUserMedia(
    constraints: MediaStreamConstraints = { video: true, audio: true },
): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia(constraints)
}

export function getDisplayMedia(constraints: DisplayMediaStreamOptions = {}): Promise<MediaStream> {
    return navigator.mediaDevices.getDisplayMedia(constraints)
}

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

export function enumerateDevices(): Promise<MediaDeviceInfo[]> {
    return navigator.mediaDevices.enumerateDevices()
}

export async function getAudioDevices(): Promise<MediaDeviceInfo[]> {
    return (await enumerateDevices()).filter((d) => d.kind === 'audioinput')
}

export async function getVideoDevices(): Promise<MediaDeviceInfo[]> {
    return (await enumerateDevices()).filter((d) => d.kind === 'videoinput')
}

export function onDeviceChange(handler: () => void): () => void {
    navigator.mediaDevices.addEventListener('devicechange', handler)
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler)
}

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
