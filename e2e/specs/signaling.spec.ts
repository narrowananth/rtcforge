import { expect, test } from '@playwright/test'

const SIGNAL = 'ws://localhost:3210'

// Two real browser tabs join the same room; one broadcasts, the other must
// receive it — the handshake→steady-state message path end-to-end (bug #8 in
// REVIEW.md lived exactly here and survived every mock).
test('two clients exchange a broadcast through the signaling server', async ({ browser }) => {
    const a = await browser.newPage()
    const b = await browser.newPage()
    await a.goto('/')
    await b.goto('/')

    await a.evaluate((s) => window.rtcforge.join(s, 'e2e-room', 'alice'), SIGNAL)
    await b.evaluate((s) => window.rtcforge.join(s, 'e2e-room', 'bob'), SIGNAL)

    // alice should observe bob joining
    await expect
        .poll(() =>
            a.evaluate(() => window.rtcforge.received.some((e) => e.type === 'peer-joined')),
        )
        .toBe(true)

    await a.evaluate(() => window.rtcforge.broadcast('chat', { text: 'hello bob' }))

    await expect
        .poll(() =>
            b.evaluate(
                () => window.rtcforge.received.find((e) => e.type === 'chat')?.msg?.text ?? null,
            ),
        )
        .toBe('hello bob')

    await a.close()
    await b.close()
})

// A dropped socket must transparently reconnect and rejoin (bugs #7/#8).
test('client reconnects after a transport drop', async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/')
    await page.evaluate((s) => window.rtcforge.join(s, 'reconnect-room', 'carol'), SIGNAL)

    // Force-close the underlying socket; reconnect: true should recover it.
    // (Browsers reject close code 1006; 4000 is in the app-allowed 3000-4999 range
    // and is treated as a retryable drop by the client.)
    await page.evaluate(() => {
        // @ts-expect-error test-only access to the transport socket
        window.__client.transport?.ws?.close(4000)
    })

    await expect
        .poll(() =>
            page.evaluate(
                () => window.rtcforge.received.filter((e) => e.type === 'connected').length,
            ),
        )
        .toBeGreaterThan(1)

    await page.close()
})
