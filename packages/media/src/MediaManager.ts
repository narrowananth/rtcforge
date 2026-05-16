export function getUserMedia(
    constraints: MediaStreamConstraints = { video: true, audio: true },
): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia(constraints)
}

export function getDisplayMedia(constraints: DisplayMediaStreamOptions = {}): Promise<MediaStream> {
    return navigator.mediaDevices.getDisplayMedia(constraints)
}
