import { defineConfig, devices } from '@playwright/test'

// Real-browser E2E for the RTCForge SDK. These exercise the paths unit tests
// cannot: actual WebSocket lifecycle, reconnect, and (when extended) real
// RTCPeerConnection negotiation — the class of behavior every CRITICAL bug in
// REVIEW.md hid behind mocks. Run with: npm run test:e2e (after
// `npx playwright install chromium`).
export default defineConfig({
    testDir: './specs',
    fullyParallel: false,
    workers: 1,
    timeout: 30_000,
    use: {
        baseURL: 'http://localhost:3211',
        trace: 'on-first-retry',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node harness/server.mjs',
        url: 'http://localhost:3211',
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        timeout: 30_000,
    },
})
