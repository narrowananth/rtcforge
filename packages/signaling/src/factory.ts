import { consoleLogger } from 'rtcforge-core'
import { SignalingServer } from './SignalingServer.js'
import type { SignalingServerOptions } from './types.js'

/**
 * Create and start a {@link SignalingServer} with production-sane defaults so the
 * quickstart is one call. Safe limits (per-peer rate limiting, `maxPayloadBytes`,
 * connection/room caps) are already on by default in {@link SignalingServer}; this
 * additionally installs a `warn`-level console {@link consoleLogger} when none is
 * supplied, so silent drops and validation failures are visible out of the box.
 *
 * @param opts - Standard {@link SignalingServerOptions}. Provide `auth` in
 *   production. Any field you set overrides the defaults.
 * @returns The started server (already listening).
 *
 * @example
 * ```ts
 * import { createSignalingServer } from 'rtcforge-signaling'
 * const server = await createSignalingServer({ port: 3001, auth })
 * ```
 */
export async function createSignalingServer(
    opts: SignalingServerOptions = {},
): Promise<SignalingServer> {
    const server = new SignalingServer({
        ...opts,
        // After the spread so an explicit `logger: undefined` still gets the default.
        logger: opts.logger ?? consoleLogger('warn'),
    })
    await server.start()
    return server
}
