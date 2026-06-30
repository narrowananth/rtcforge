import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { toError } from 'rtcforge-core'
import type { Logger, MetricsCollector } from 'rtcforge-core'
import { AuthPayloadSchema, CloseCode, CloseReason, Metric } from './types.js'
import type { AuthFunction } from './types.js'

export interface ResolvedAuth {
    roomId: string
    peerId: string
    role: string
    metadata?: Record<string, string>
}

export type AuthResult =
    | { ok: true; auth: ResolvedAuth }
    | { ok: false; code: number; reason: string }

export interface AuthenticatorDeps {
    auth?: AuthFunction
    serverAssignedPeerId?: boolean
    logger: Logger
    metrics: MetricsCollector
}

export class Authenticator {
    constructor(private readonly deps: AuthenticatorDeps) {}

    async resolve(req: IncomingMessage): Promise<AuthResult> {
        const { logger, metrics } = this.deps
        const url = new URL(req.url ?? '/', 'ws://localhost')
        const token = url.searchParams.get('token') ?? ''

        let roomId: string
        let role: string
        let declaredPeerId: string
        let metadata: Record<string, string> | undefined

        if (this.deps.auth) {
            let raw: unknown
            try {
                raw = await this.deps.auth(token)
            } catch (err) {
                const reason = toError(err).message || CloseReason.AuthFailed
                logger.warn('Auth failed', { reason })
                metrics.increment(Metric.AuthErrors, { reason: 'auth_exception' })
                return { ok: false, code: CloseCode.PolicyViolation, reason }
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
            if (!r || !p) {
                logger.warn('Auth failed: missing roomId or peerId')
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
