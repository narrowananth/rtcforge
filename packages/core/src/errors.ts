/**
 * Base class for all errors thrown by RTCForge.
 *
 * Every RTCForge error carries a stable machine-readable {@link RtcForgeError.code | code}
 * in addition to the human-readable message, so callers can branch on the failure kind
 * without matching on message text. The error `name` is set to the concrete subclass name.
 *
 * @remarks
 * Use {@link isRtcForgeError} to narrow an unknown caught value to this type and,
 * optionally, to a specific code.
 *
 * @example
 * ```ts
 * try {
 *   ring.add({ id: 'node-a', weight: -1 })
 * } catch (err) {
 *   if (isRtcForgeError(err)) {
 *     console.error(err.code, err.message)
 *   }
 * }
 * ```
 */
export class RtcForgeError extends Error {
    /** Stable machine-readable error code identifying the failure kind (e.g. `INVALID_ARGUMENT`). */
    readonly code: string

    /**
     * @param message - Human-readable description of what went wrong.
     * @param code - Stable machine-readable code identifying the failure kind.
     * @param options - Optional settings.
     * @param options.cause - The underlying error or value that caused this error, attached as the standard `cause` property.
     */
    constructor(message: string, code: string, options?: { cause?: unknown }) {
        super(message)
        this.name = new.target.name
        this.code = code
        if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause
    }
}

/**
 * Error thrown when a caller passes an argument that fails validation.
 *
 * @remarks
 * Its {@link RtcForgeError.code | code} is always `INVALID_ARGUMENT`.
 */
export class InvalidArgumentError extends RtcForgeError {
    /**
     * @param message - Human-readable description of the invalid argument.
     */
    constructor(message: string) {
        super(message, 'INVALID_ARGUMENT')
    }
}

/**
 * Type guard that checks whether a value is a {@link RtcForgeError}, optionally
 * matching a specific error code.
 *
 * @param err - The value to test, typically a caught `unknown`.
 * @param code - When provided, additionally requires the error's `code` to equal this value.
 * @returns `true` if `err` is a {@link RtcForgeError} (and matches `code` when given), narrowing its type.
 *
 * @example
 * ```ts
 * try {
 *   doWork()
 * } catch (err) {
 *   if (isRtcForgeError(err, 'INVALID_ARGUMENT')) {
 *     // err is narrowed to RtcForgeError here
 *     retryWithDefaults()
 *   }
 * }
 * ```
 */
export function isRtcForgeError(err: unknown, code?: string): err is RtcForgeError {
    return err instanceof RtcForgeError && (code === undefined || err.code === code)
}
