import { FileTransferError, FileTransferErrorCode } from './errors.js'

export function waitForOpen(channel: RTCDataChannel, transferId?: string): Promise<void> {
    if (channel.readyState === 'open') return Promise.resolve()
    if (channel.readyState === 'closing' || channel.readyState === 'closed') {
        return Promise.reject(
            new FileTransferError(
                `data channel '${channel.label}' is ${channel.readyState}`,
                FileTransferErrorCode.ChannelClosed,
                { transferId },
            ),
        )
    }
    return new Promise<void>((resolve, reject) => {
        const onOpen = () => {
            cleanup()
            resolve()
        }
        const onClose = () => {
            cleanup()
            reject(
                new FileTransferError(
                    `data channel '${channel.label}' closed before opening`,
                    FileTransferErrorCode.ChannelClosed,
                    { transferId },
                ),
            )
        }
        const cleanup = () => {
            channel.removeEventListener('open', onOpen)
            channel.removeEventListener('close', onClose)
            channel.removeEventListener('error', onClose)
        }
        channel.addEventListener('open', onOpen)
        channel.addEventListener('close', onClose)
        channel.addEventListener('error', onClose)
    })
}

export function awaitDrain(
    channel: RTCDataChannel,
    highWaterMark: number,
    lowWaterMark: number,
    transferId?: string,
): Promise<void> {
    if (channel.bufferedAmount <= highWaterMark) return Promise.resolve()
    // If the channel already closed before we got here, its close/error events
    // have already fired — the listeners below would never trigger and the
    // worker would hang. Reject up front, mirroring waitForOpen.
    if (channel.readyState !== 'open') {
        return Promise.reject(
            new FileTransferError(
                `data channel '${channel.label}' is ${channel.readyState}`,
                FileTransferErrorCode.ChannelClosed,
                { transferId },
            ),
        )
    }
    channel.bufferedAmountLowThreshold = lowWaterMark
    return new Promise<void>((resolve, reject) => {
        const onLow = () => {
            cleanup()
            resolve()
        }
        // Without close/error listeners a peer that disconnects while the buffer
        // is above the high-water mark never fires 'bufferedamountlow', leaving
        // the send worker awaiting forever. Reject so the worker can abort.
        const onClose = () => {
            cleanup()
            reject(
                new FileTransferError(
                    `data channel '${channel.label}' closed while draining`,
                    FileTransferErrorCode.ChannelClosed,
                    { transferId },
                ),
            )
        }
        const cleanup = () => {
            channel.removeEventListener('bufferedamountlow', onLow)
            channel.removeEventListener('close', onClose)
            channel.removeEventListener('error', onClose)
        }
        channel.addEventListener('bufferedamountlow', onLow)
        channel.addEventListener('close', onClose)
        channel.addEventListener('error', onClose)
    })
}
