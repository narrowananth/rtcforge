export class RtcForgeError extends Error {
    readonly code: string

    constructor(message: string, code: string, options?: { cause?: unknown }) {
        super(message)
        this.name = new.target.name
        this.code = code
        if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause
    }
}

export class InvalidArgumentError extends RtcForgeError {
    constructor(message: string) {
        super(message, 'INVALID_ARGUMENT')
    }
}

export function isRtcForgeError(err: unknown, code?: string): err is RtcForgeError {
    return err instanceof RtcForgeError && (code === undefined || err.code === code)
}
