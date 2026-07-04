import { noopLogger } from 'rtcforge-core'
import type { Logger, Membership, NetworkStats, NodeInfo } from 'rtcforge-core'
import type { SfuNode } from './SfuNode.js'

export type { Logger, NetworkStats, Membership, NodeInfo }
export { noopLogger }

/**
 * Discrete quality tier derived from a node's live network statistics.
 *
 * Used to drive adaptive decisions such as simulcast layer selection or
 * forwarding-quality changes.
 *
 * - `high` — healthy link; full quality can be forwarded.
 * - `medium` — degraded link; a reduced quality tier is advisable.
 * - `low` — poor link; the lowest quality tier should be used.
 */
export type BandwidthQuality = 'high' | 'medium' | 'low'

/**
 * Pluggable policy for choosing which SFU node should serve a given room.
 *
 * Implementations receive the set of candidate nodes (already filtered to
 * healthy, non-draining nodes by the {@link SfuCluster}) and return the chosen
 * node, or `undefined` when no candidate is suitable.
 *
 * @see LeastLoadedStrategy
 * @see HashRingStrategy
 */
export interface PlacementStrategy {
    /**
     * Select a node from the candidate set.
     *
     * @param candidates - Eligible nodes to choose from.
     * @param region - Optional preferred region; strategies typically restrict
     * selection to nodes in this region when any exist, otherwise fall back to
     * the full set.
     * @param key - Optional routing key (for example the room id) used by
     * deterministic strategies to map the same key to the same node.
     * @returns The selected node, or `undefined` when `candidates` is empty.
     */
    select(candidates: SfuNode[], region?: string, key?: string): SfuNode | undefined
}

/**
 * Lifecycle and telemetry events emitted by an {@link SfuNode}.
 */
export const SfuNodeEvent = {
    /** Fired whenever a new load value is reported via `reportLoad`. */
    Load: 'load',
    /** Fired when reported load first reaches or exceeds the node capacity. */
    Overloaded: 'overloaded',
    /** Fired when the node is marked failed (for example by a health check). */
    Failed: 'failed',
    /** Fired when a previously failed node is marked recovered. */
    Recovered: 'recovered',
    /** Fired when the node begins draining and stops accepting new rooms. */
    Draining: 'draining',
    /** Fired when draining completes (all rooms gone or the drain timed out). */
    Drained: 'drained',
    /** Fired with a {@link BandwidthQuality} tier from the stats collector. */
    BandwidthEstimate: 'bandwidth-estimate',
} as const

/** Union of the string values of {@link SfuNodeEvent}. */
export type SfuNodeEvent = (typeof SfuNodeEvent)[keyof typeof SfuNodeEvent]

/**
 * Construction options for an {@link SfuNode}.
 */
export interface SfuNodeOptions {
    /**
     * Maximum load the node can carry before it is considered overloaded.
     *
     * @defaultValue 100
     */
    capacity?: number
    /** Logger used for node-level diagnostics. Defaults to a no-op logger. */
    logger?: Logger
}

/**
 * Membership and health events emitted by an {@link SfuCluster}.
 */
export const SfuClusterEvent = {
    /** Fired when a node is added to the cluster. */
    NodeAdded: 'nodeAdded',
    /** Fired when a node is removed from the cluster. */
    NodeRemoved: 'nodeRemoved',
    /** Fired when every active node in the cluster is overloaded. */
    Overloaded: 'overloaded',
    /** Fired when a cluster operation surfaces an error (for example a failed health check). */
    Error: 'error',
} as const

/** Union of the string values of {@link SfuClusterEvent}. */
export type SfuClusterEvent = (typeof SfuClusterEvent)[keyof typeof SfuClusterEvent]

/**
 * Adapter the {@link SfuBridge} calls to apply routing decisions onto a
 * concrete media plane.
 *
 * Implement this to connect the router's room-to-node assignments (and cascade
 * fan-out routes) to your SFU's actual forwarding tables.
 */
export interface SfuMediaInterface {
    /** Add a forwarding route for `roomId` targeting the node `nodeId`. May be async so real pipe setup can be awaited and surface failures. */
    addRoute(roomId: string, nodeId: string): void | Promise<void>
    /** Remove all forwarding routes for `roomId`. */
    removeRoute(roomId: string): void | Promise<void>
    /** Return the node ids currently routed for `roomId`. */
    getRoutes(roomId: string): string[]
    /** Remove only the cascade route from `roomId` to `nodeId`. */
    removeCascadeRoute(roomId: string, nodeId: string): void | Promise<void>
}

/**
 * Adapter the {@link CascadeBridge} calls to create and tear down inter-node
 * media pipes on a concrete media plane.
 *
 * Implement this to realize the parent-to-child links of a cascade fan-out
 * {@link CascadeTree} as real media forwarding between SFU nodes.
 */
export interface CascadePipeInterface {
    /** Establish a media pipe carrying `roomId` from `fromNodeId` to `toNodeId`. May be async so the pipe setup can be awaited and surface failures. */
    pipeLink(roomId: string, fromNodeId: string, toNodeId: string): void | Promise<void>
    /** Tear down the media pipe carrying `roomId` from `fromNodeId` to `toNodeId`. */
    unpipeLink(roomId: string, fromNodeId: string, toNodeId: string): void | Promise<void>
}

/**
 * Construction options for an {@link SfuCluster}.
 */
export interface SfuClusterOptions {
    /** Logger used for cluster-level diagnostics. Defaults to a no-op logger. */
    logger?: Logger
    /**
     * Active health-check configuration. When `onCheck` is provided,
     * {@link SfuCluster.startHealthChecks} polls each node on an interval and
     * marks it failed (triggering a rebalance) when the check returns `false`.
     */
    healthCheck?: {
        /**
         * Interval between health-check sweeps, in milliseconds.
         *
         * @defaultValue 30000
         */
        intervalMs?: number
        /** Probe returning whether the node with `nodeId` is currently healthy. */
        onCheck?: (nodeId: string) => Promise<boolean>
        /**
         * Milliseconds a single probe may run before being treated as failed.
         * Guards against a hung probe wedging a node. @defaultValue `intervalMs`
         */
        probeTimeoutMs?: number
        /**
         * Consecutive failed sweeps required before a node is marked failed.
         * Higher values suppress flapping from a single transient timeout.
         * @defaultValue `3`
         */
        failureThreshold?: number
        /**
         * Consecutive passing sweeps required before a failed node is marked
         * recovered. @defaultValue `2`
         */
        recoveryThreshold?: number
    }
    /**
     * Callback invoked for each drained or failed node during a rebalance,
     * so the host can migrate that node's rooms elsewhere.
     */
    onRebalance?: (fromNodeId: string, reason: 'draining' | 'failed') => void
    /**
     * Node-selection policy used by {@link SfuCluster.assignNode}.
     *
     * @defaultValue a new {@link LeastLoadedStrategy}
     */
    placementStrategy?: PlacementStrategy
    /**
     * Optional membership source. When provided, the cluster reconciles its
     * node set against it automatically, adding and removing nodes as
     * membership changes.
     */
    membership?: Membership
    /**
     * Factory that builds an {@link SfuNode} from membership {@link NodeInfo}.
     * Only used when {@link SfuClusterOptions.membership} is set.
     *
     * @defaultValue a factory creating `new SfuNode(info.id, info.region ?? 'default')`
     */
    nodeFactory?: (info: NodeInfo) => SfuNode
}

/**
 * Room-assignment and cascade events emitted by a {@link CascadingRouter}.
 */
export const CascadingRouterEvent = {
    /** Fired when a room is assigned to its primary SFU node. */
    RoomAssigned: 'roomAssigned',
    /** Fired when an additional node is cascaded onto an already-assigned room. */
    CascadeCreated: 'cascadeCreated',
    /** Fired when a room is fully detached from the SFU (primary and cascades). */
    RoomDetached: 'roomDetached',
    /** Fired when a single cascade node is dropped from a room after it failed. */
    CascadeDropped: 'cascadeDropped',
} as const

/** Union of the string values of {@link CascadingRouterEvent}. */
export type CascadingRouterEvent = (typeof CascadingRouterEvent)[keyof typeof CascadingRouterEvent]

/**
 * Construction options for a {@link CascadingRouter}.
 */
export interface CascadingRouterOptions {
    /** Logger used for router diagnostics. Defaults to a no-op logger. */
    logger?: Logger
}

/**
 * Structural events emitted by a {@link CascadeTree} as fan-out plans are
 * built, diffed, and torn down.
 */
export const CascadeTreeEvent = {
    /** Fired with the full {@link CascadePlan} whenever a room's tree is (re)built. */
    TreeBuilt: 'treeBuilt',
    /** Fired for each parent-to-child link added relative to the previous plan. */
    LinkCreated: 'linkCreated',
    /** Fired for each parent-to-child link removed relative to the previous plan. */
    LinkDropped: 'linkDropped',
    /** Fired for each leaf node assigned viewer slots, with the slot count. */
    LeafAssigned: 'leafAssigned',
    /** Fired when a room's tree is fully torn down. */
    TreeDropped: 'treeDropped',
    /** Fired when the plan cannot seat all viewers, with the unmet viewer count. */
    CapacityShortfall: 'capacityShortfall',
    /**
     * Fired when a room's origin node fails. The tree is torn down and cannot be
     * rebuilt automatically — the origin ingests the source media, so recovery
     * requires re-originating the room (host re-publish / failover) and calling
     * {@link CascadeTree.build} with a new origin.
     */
    OriginLost: 'originLost',
} as const

/** Union of the string values of {@link CascadeTreeEvent}. */
export type CascadeTreeEvent = (typeof CascadeTreeEvent)[keyof typeof CascadeTreeEvent]

/**
 * Construction options for a {@link CascadeTree}.
 */
export interface CascadeTreeOptions {
    /**
     * Maximum number of children each relay node may fan out to. Larger values
     * produce shallower, wider trees.
     *
     * @defaultValue 8
     */
    fanout?: number
    /**
     * Default viewer capacity assumed per node when a node's own capacity is
     * unavailable.
     *
     * @defaultValue 1000
     */
    viewersPerNode?: number
    /** Logger used for tree diagnostics. Defaults to a no-op logger. */
    logger?: Logger
}

/**
 * Maps live network statistics to a discrete {@link BandwidthQuality} tier.
 *
 * @see SimpleBandwidthEstimator
 */
export interface BandwidthEstimator {
    /** Compute the current quality tier from a network stats sample. */
    estimate(stats: NetworkStats): BandwidthQuality
    /** Reset internal state (streak counters, committed quality) to defaults. */
    reset(): void
}

/**
 * Threshold and hysteresis options for the {@link SimpleBandwidthEstimator}.
 *
 * Streak options add hysteresis so that a single noisy sample does not flip the
 * committed quality tier.
 */
export interface SimpleBandwidthEstimatorOptions {
    /**
     * Packet-loss ratio (0-1) at or above which quality is forced to `low`.
     *
     * @defaultValue 0.1
     */
    packetLossHighThreshold?: number
    /**
     * Packet-loss ratio (0-1) at or above which quality drops to `medium`.
     *
     * @defaultValue 0.03
     */
    packetLossMedThreshold?: number
    /**
     * Round-trip time in milliseconds at or above which quality is forced to `low`.
     *
     * @defaultValue 300
     */
    rttHighThreshold?: number
    /**
     * Round-trip time in milliseconds at or above which quality drops to `medium`.
     *
     * @defaultValue 150
     */
    rttMedThreshold?: number
    /**
     * Minimum bitrate in kbps below which quality drops to `medium`.
     *
     * @defaultValue 500
     */
    bitrateMinKbps?: number
    /**
     * Consecutive samples pointing downward required before committing a lower tier.
     *
     * @defaultValue 2
     */
    downgradeStreak?: number
    /**
     * Consecutive samples pointing upward required before committing a higher tier.
     *
     * @defaultValue 3
     */
    upgradeStreak?: number
}
