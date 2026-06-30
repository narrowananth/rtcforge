import { RtcForgeError } from '@rtcforge/core'

export class NoAvailableNodeError extends RtcForgeError {
    constructor(message = 'No available SFU node in cluster') {
        super(message, 'NO_AVAILABLE_NODE')
    }
}
