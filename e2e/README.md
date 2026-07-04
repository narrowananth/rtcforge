# RTCForge browser E2E

Real-browser end-to-end tests. Unit tests mock `WebSocket`/`RTCPeerConnection`,
so they cannot catch the class of bug that dominated `REVIEW.md` (handshake
message gaps, reconnect loops, ICE negotiation, backpressure). These run the
built SDK in headless Chromium against a real `SignalingServer`.

## Run

```bash
npm run build                       # build the packages the harness serves
npm i -D @playwright/test esbuild   # if not already present
npx playwright install chromium     # one-time browser download
npm run test:e2e
```

## Layout

- `harness/server.mjs` — starts a real `SignalingServer` + serves the bundled client
- `harness/client-entry.mjs` — drives the browser SDK, exposes `window.rtcforge`
- `specs/*.spec.ts` — the tests (two-client broadcast, reconnect)
- `playwright.config.ts` — Chromium project + `webServer` wiring

## Extending

The highest-value additions map to the still-mock-only failures in `REVIEW.md`:
glare/rollback on `Call`, negotiation-timeout on renegotiation, ICE restart on a
network blip, and file-transfer backpressure-then-disconnect. Add a `Call`-based
media harness page and drive two contexts through a real `RTCPeerConnection`.
