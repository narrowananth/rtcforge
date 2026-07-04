// E2E harness server: starts a real RTCForge SignalingServer and serves a tiny
// page that drives the *built* browser SDK in a real browser. The client entry
// is bundled on the fly with esbuild so bare imports (rtcforge-core, zod)
// resolve without an import map. Launched by Playwright's `webServer`.
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import { SignalingServer } from 'rtcforge-signaling'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SIGNAL_PORT = Number(process.env.SIGNAL_PORT ?? 3210)
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 3211)

const signaling = new SignalingServer({
    port: SIGNAL_PORT,
    // Open (no auth) — the harness assigns peerId via the query string.
    rateLimit: { maxMessagesPerSecond: 0 },
})
await signaling.start()

// Bundle the browser client entry once at startup.
const bundle = await esbuild.build({
    entryPoints: [join(__dirname, 'client-entry.mjs')],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'browser',
})
const appJs = bundle.outputFiles[0].text

const html = await readFile(join(__dirname, 'index.html'), 'utf8')

const httpServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/app.js')) {
        res.writeHead(200, { 'content-type': 'text/javascript' })
        res.end(appJs)
        return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(html.replace('__SIGNAL_URL__', `ws://localhost:${SIGNAL_PORT}`))
})
httpServer.listen(HTTP_PORT, () => {
    // Playwright waits for this line on stdout.
    console.log(`harness ready http://localhost:${HTTP_PORT}`)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
        void signaling.stop()
        httpServer.close()
        process.exit(0)
    })
}
