import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { toError } from 'rtcforge-core'
import type { Logger, MetricsCollector } from 'rtcforge-core'
import { AuthPayloadSchema, CloseCode, CloseReason, Metric } from './types.js'
import type { AuthFunction } from './types.js'

/**
 * The identity and room a connection resolved to after successful authentication.
 */
export interface ResolvedAuth {
    /** Id of the room the peer is authorized to join. */
    roomId: string
    /** The peer's id (client-declared or server-assigned). */
    peerId: string
    /** Role granted to the peer, used for authorization downstream. */
    role: string
    /** Optional free-form metadata carried alongside the identity. */
    metadata?: Record<string, string>
}

/**
 * Outcome of {@link Authenticator.resolve}: either a resolved identity or a close code + reason.
 */
export type AuthResult =
    | { ok: true; auth: ResolvedAuth }
    | { ok: false; code: number; reason: string }

/**
 * Collaborators a {@link Authenticator} depends on.
 */
export interface AuthenticatorDeps {
    /** Application auth callback validating a token; omit to allow anonymous joins. */
    auth?: AuthFunction
    /** When `true`, the server assigns peer ids instead of trusting the client-declared one. */
    serverAssignedPeerId?: boolean
    /** Logger for auth diagnostics (real errors logged internally, never sent to clients). */
    logger: Logger
    /** Metrics sink for auth success/failure counters. */
    metrics: MetricsCollector
}

/**
 * Authenticates an incoming connection and resolves the room/identity it may join.
 *
 * @remarks
 * {@link Authenticator.resolve | resolve} extracts a token from the `?token=`
 * query param or an `Authorization: Bearer` header, runs the optional
 * {@link AuthFunction}, and validates the result. On failure it logs the real
 * error internally but returns only a generic close code/reason, never leaking
 * internal messages to the client. When `serverAssignedPeerId` is set, it mints a
 * peer id rather than trusting the client's.
 */
export class Authenticator {
    constructor(private readonly deps: AuthenticatorDeps) {}

    async resolve(req: IncomingMessage): Promise<AuthResult> {
        const { logger, metrics } = this.deps
        const url = new URL(req.url ?? '/', 'ws://localhost')
        // Prefer the `?token=` query param; fall back to an
        // `Authorization: Bearer <token>` header when it is absent.
        let token = url.searchParams.get('token') ?? ''
        if (!token) {
            const authHeader = req.headers.authorization
            if (authHeader?.startsWith('Bearer ')) {
                token = authHeader.slice('Bearer '.length).trim()
            }
        }

        let roomId: string
        let role: string
        let declaredPeerId: string
        let metadata: Record<string, string> | undefined

        if (this.deps.auth) {
            let raw: unknown
            try {
                raw = await this.deps.auth(token)
            } catch (err) {
                // Log the real error internally, but send only a GENERIC reason to
                // the client — never leak internal messages (e.g. DB errors), and
                // avoid the >123-byte close-reason throw a long message would cause.
                logger.warn('Auth failed', { reason: toError(err).message })
                metrics.increment(Metric.AuthErrors, { reason: 'auth_exception' })
                return {
                    ok: false,
                    code: CloseCode.PolicyViolation,
                    reason: CloseReason.AuthFailed,
                }
            }
            const result = AuthPayloadSchema.safeParse(raw)
            if (!result.success) {
                logger.warn('Auth failed: invalid payload', { tokenLength: token.length })
                metrics.increment(Metric.AuthErrors, { reason: 'invalid_payload' })
                return {
                    ok: false,
                    code: CloseCode.PolicyViolation,
                    reason: CloseReason.InvalidAuthPayload,
                }
            }
            roomId = result.data.roomId
            role = result.data.role
            declaredPeerId = result.data.peerId
            metadata = result.data.metadata
        } else {
            const r = url.searchParams.get('roomId')
            const p = url.searchParams.get('peerId')
            // Bound raw query values: in no-auth mode these are attacker-controlled
            // and otherwise only truthiness-checked, so an oversized id could be
            // used as a memory-amplification vector (room map keys, metadata, etc.).
            const MAX_ID_LENGTH = 256
            if (!r || !p || r.length > MAX_ID_LENGTH || p.length > MAX_ID_LENGTH) {
                logger.warn('Auth failed: missing or oversized roomId or peerId')
                metrics.increment(Metric.AuthErrors, { reason: 'missing_params' })
                return {
                    ok: false,
                    code: CloseCode.PolicyViolation,
                    reason: CloseReason.MissingRoomOrPeer,
                }
            }
            roomId = r
            declaredPeerId = p
            role = ''
        }

        const peerId = this.deps.serverAssignedPeerId ? randomUUID() : declaredPeerId
        return { ok: true, auth: { roomId, peerId, role, metadata } }
    }
}
