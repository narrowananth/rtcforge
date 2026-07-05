import { RtcForgeError } from 'rtcforge-core'

/**
 * Thrown when room placement is requested but no SFU node can accept it.
 *
 * @remarks
 * Raised by placement/routing when every node in the cluster is down, draining,
 * or over capacity. Carries the stable error code `NO_AVAILABLE_NODE` for
 * programmatic handling.
 */
export class NoAvailableNodeError extends RtcForgeError {
    constructor(message = 'No available SFU node in cluster') {
        super(message, 'NO_AVAILABLE_NODE')
    }
}
