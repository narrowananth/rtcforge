import { consoleLogger } from 'rtcforge-core'
import { RTCForgeClient } from './RTCForgeClient.js'
import type { RTCForgeClientOptions } from './types.js'

/**
 * Construct an {@link RTCForgeClient} with sensible defaults: reconnect on and a
 * `warn`-level console {@link consoleLogger} when none is supplied, so silent
 * drops and validation failures are visible during development. Anything you set
 * overrides the defaults.
 *
 * @param opts - Standard {@link RTCForgeClientOptions}; `serverUrl` is required.
 * @returns A ready client — call {@link RTCForgeClient.joinRoom} to join.
 *
 * @example
 * ```ts
 * import { createClient } from 'rtcforge-sdk'
 * const room = await createClient({ serverUrl, token }).joinRoom('general')
 * ```
 */
export function createClient(opts: RTCForgeClientOptions): RTCForgeClient {
    return new RTCForgeClient({
        reconnect: true,
        ...opts,
        // After the spread so an explicit `logger: undefined` still gets the default.
        logger: opts.logger ?? consoleLogger('warn'),
    })
}
