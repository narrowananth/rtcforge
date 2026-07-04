export { FileTransferManager } from './FileTransferManager.js'
export type { FileTransferManagerEvents, SendInput } from './FileTransferManager.js'
export { SendTransfer } from './SendTransfer.js'
export type { ControlSender, SendTransferParams } from './SendTransfer.js'
export { ReceiveTransfer } from './ReceiveTransfer.js'
export type { ReceiveTransferParams } from './ReceiveTransfer.js'
export { Transfer } from './Transfer.js'
export type { TransferEvents } from './Transfer.js'

export { FileTransferError, FileTransferErrorCode } from './errors.js'

export {
    DEFAULT_CHUNK_SIZE,
    DEFAULT_HIGH_WATER_MARK,
    DEFAULT_LOW_WATER_MARK,
    DEFAULT_PARALLEL_CHANNELS,
    FileTransferEvent,
    resolveTuning,
    TransferDirection,
    TransferEvent,
    TransferState,
} from './types.js'
export type {
    DataChannelHub,
    FileMetadata,
    FileTransferOptions,
    ResolvedTuning,
    SendOptions,
    TransferProgress,
    TransferTuning,
} from './types.js'

export type { FileSource } from './source/FileSource.js'
export { BlobFileSource } from './source/BlobFileSource.js'
export type { SinkResult, StorageSink } from './sink/StorageSink.js'
export { MemorySink } from './sink/MemorySink.js'
export { FileSystemAccessSink } from './sink/FileSystemAccessSink.js'

export { encodeFrame, decodeFrame, FRAME_HEADER_BYTES } from './framing.js'
export { sanitizeFileName } from './sanitize.js'
export { sha256Hex, Sha256Digest } from './checksum.js'
export {
    ControlType,
    CONTROL_CHANNEL_LABEL,
    FT_PROTOCOL_VERSION,
    dataChannelLabel,
    parseDataChannelLabel,
} from './protocol.js'
export type { ControlMessage, OfferMessage } from './protocol.js'
