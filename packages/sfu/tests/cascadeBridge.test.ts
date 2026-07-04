import { describe, expect, it } from 'vitest'
import { CascadeBridge, CascadeBridgeEvent } from '../src/CascadeBridge.js'
import { CascadeTree } from '../src/CascadeTree.js'
import { SfuCluster } from '../src/SfuCluster.js'
import { SfuNode } from '../src/SfuNode.js'
import type { CascadePipeInterface } from '../src/types.js'

const pool = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`)

function cluster(n: number): SfuCluster {
    const c = new SfuCluster()
    for (const id of ['origin', ...pool(n)])
        c.addNode(new SfuNode(id, 'us-east', { capacity: 100_000 }))
    return c
}

function recordingMedia() {
    const piped: string[] = []
    const unpiped: string[] = []
    const media: CascadePipeInterface = {
        pipeLink: (roomId, from, to) => {
            piped.push(`${roomId}:${from}>${to}`)
        },
        unpipeLink: (roomId, from, to) => {
            unpiped.push(`${roomId}:${from}>${to}`)
        },
    }
    return { media, piped, unpiped }
}

describe('CascadeBridge — wires CascadeTree links to the media plane', () => {
    it('calls pipeLink for every tree edge on build', () => {
        const c = cluster(6)
        const tree = new CascadeTree(c, { fanout: 2, viewersPerNode: 10 })
        const { media, piped } = recordingMedia()
        new CascadeBridge(tree, media).attach()

        const plan = tree.build('stream1', 'origin', 35)
        expect(piped.length).toBe(plan.links.length)
        for (const l of plan.links) expect(piped).toContain(`stream1:${l.from}>${l.to}`)
    })

    it('emits unpipeLink for links dropped on rebuild, pipeLink for new ones', () => {
        const c = cluster(10)
        const tree = new CascadeTree(c, { fanout: 2, viewersPerNode: 10 })
        const { media, piped, unpiped } = recordingMedia()
        new CascadeBridge(tree, media).attach()

        const plan = tree.build('stream1', 'origin', 35)
        const before = piped.length
        const victim = [...plan.nodes.keys()].find((id) => id !== 'origin') as string

        c.nodes.find((n) => n.id === victim)?.markFailed()
        ;(tree as never as { _onNodeGone: (id: string) => void })._onNodeGone(victim)

        expect(unpiped.length).toBeGreaterThan(0)
        expect(piped.length).toBeGreaterThan(before)
        const newPlan = tree.getPlan('stream1')
        expect(newPlan?.nodes.has(victim)).toBe(false)
    })

    it('detach tears down all outstanding links and stops listening', () => {
        const c = cluster(6)
        const tree = new CascadeTree(c, { fanout: 2, viewersPerNode: 10 })
        const { media, piped, unpiped } = recordingMedia()
        const bridge = new CascadeBridge(tree, media)
        bridge.attach()
        tree.build('stream1', 'origin', 35)

        bridge.detach()
        expect(unpiped.length).toBe(piped.length)

        const pipedAfter = piped.length
        tree.build('stream2', 'origin', 35)
        expect(piped.length).toBe(pipedAfter)
    })

    it('emits PipeError when an async media pipe rejects', async () => {
        const c = cluster(6)
        const tree = new CascadeTree(c, { fanout: 2, viewersPerNode: 10 })
        const media: CascadePipeInterface = {
            pipeLink: async () => Promise.reject(new Error('pipe down')),
            unpipeLink: () => {},
        }
        const bridge = new CascadeBridge(tree, media)
        const errors: Error[] = []
        bridge.on(CascadeBridgeEvent.PipeError, (_r, _f, _t, err) => errors.push(err))
        bridge.attach()

        tree.build('stream1', 'origin', 35) // triggers pipeLink rejections
        await new Promise((r) => setTimeout(r, 0))

        expect(errors.length).toBeGreaterThan(0)
        expect(errors[0]?.message).toBe('pipe down')
    })
})
