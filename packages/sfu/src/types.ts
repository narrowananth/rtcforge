import { noopLogger } from 'rtcforge-core'
import type { Logger, Membership, NetworkStats, NodeInfo } from 'rtcforge-core'
import type { SfuNode } from './SfuNode.js'

export type { Logger, NetworkStats, Membership, NodeInfo }
export { noopLogger }

export type BandwidthQuality = 'high' | 'medium' | 'low'

export interface PlacementStrategy {
    select(candidates: SfuNode[], region?: string, key?: string): SfuNode | undefined
}

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
    Error: 'error',
} as const

export type SfuClusterEvent = (typeof SfuClusterEvent)[keyof typeof SfuClusterEvent]

export interface SfuMediaInterface {
    addRoute(roomId: string, nodeId: string): void
    removeRoute(roomId: string): void
    getRoutes(roomId: string): string[]
    removeCascadeRoute(roomId: string, nodeId: string): void
}

export interface CascadePipeInterface {
    pipeLink(roomId: string, fromNodeId: string, toNodeId: string): void
    unpipeLink(roomId: string, fromNodeId: string, toNodeId: string): void
}

export interface SfuClusterOptions {
    logger?: Logger
    healthCheck?: {
        intervalMs?: number
        onCheck?: (nodeId: string) => Promise<boolean>
    }
    onRebalance?: (fromNodeId: string, reason: 'draining' | 'failed') => void
    placementStrategy?: PlacementStrategy
    membership?: Membership
    nodeFactory?: (info: NodeInfo) => SfuNode
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

export const CascadeTreeEvent = {
    TreeBuilt: 'treeBuilt',
    LinkCreated: 'linkCreated',
    LinkDropped: 'linkDropped',
    LeafAssigned: 'leafAssigned',
    TreeDropped: 'treeDropped',
    CapacityShortfall: 'capacityShortfall',
} as const

export type CascadeTreeEvent = (typeof CascadeTreeEvent)[keyof typeof CascadeTreeEvent]

export interface CascadeTreeOptions {
    fanout?: number
    viewersPerNode?: number
    logger?: Logger
}

export interface BandwidthEstimator {
    estimate(stats: NetworkStats): BandwidthQuality
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
