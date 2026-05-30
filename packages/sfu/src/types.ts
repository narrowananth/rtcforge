import { noopLogger } from '@rtcforge/core'
import type { Logger } from '@rtcforge/core'

export type { Logger }
export { noopLogger }

export const SfuNodeEvent = {
    Load: 'load',
    Overloaded: 'overloaded',
    Failed: 'failed',
    Recovered: 'recovered',
    Draining: 'draining',
    Drained: 'drained',
    BandwidthEstimate: 'bandwidth-estimate',
} as const

export type SfuNodeEvent = (typeof SfuNodeEvent)[keyof typeof SfuNodeEvent]

export interface SfuNodeOptions {
    capacity?: number
    logger?: Logger
}

export const SfuClusterEvent = {
    NodeAdded: 'nodeAdded',
    NodeRemoved: 'nodeRemoved',
    Overloaded: 'overloaded',
} as const

export type SfuClusterEvent = (typeof SfuClusterEvent)[keyof typeof SfuClusterEvent]

/**
 * Associate a room with an SFU node for media routing.
 *
 * **Cascade semantics**: `addRoute` is called once for the primary assignment
 * and then again for every cascade node. Implementations MUST treat this as
 * an additive operation (e.g. maintain a list of node IDs per room), NOT as a
 * setter that replaces the previous node — doing so would silently drop the
 * primary route when the first cascade link is created.
 */
export interface SfuMediaInterface {
    addRoute(roomId: string, nodeId: string): void
    removeRoute(roomId: string): void
    getRoutes(roomId: string): string[]
    removeCascadeRoute(roomId: string, nodeId: string): void
}

export interface SfuClusterOptions {
    logger?: Logger
    mediaService?: SfuMediaInterface
    healthCheck?: {
        intervalMs?: number
        onCheck?: (nodeId: string) => Promise<boolean>
    }
    onRebalance?: (fromNodeId: string, reason: 'draining' | 'failed') => void
}

export const CascadingRouterEvent = {
    RoomAssigned: 'roomAssigned',
    CascadeCreated: 'cascadeCreated',
    RoomDetached: 'roomDetached',
    CascadeDropped: 'cascadeDropped',
} as const

export type CascadingRouterEvent = (typeof CascadingRouterEvent)[keyof typeof CascadingRouterEvent]

export interface CascadingRouterOptions {
    logger?: Logger
}

export interface BandwidthEstimator {
    estimate(stats: { bitrate: number; packetLoss: number; rtt: number }): 'high' | 'medium' | 'low'
    reset(): void
}

export interface SimpleBandwidthEstimatorOptions {
    packetLossHighThreshold?: number
    packetLossMedThreshold?: number
    rttHighThreshold?: number
    rttMedThreshold?: number
    bitrateMinKbps?: number
    downgradeStreak?: number
    upgradeStreak?: number
}
