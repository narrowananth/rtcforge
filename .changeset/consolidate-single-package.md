---
"rtcforge": minor
---

Consolidate into a single self-contained package. `rtcforge` no longer depends on any `rtcforge-*` package — all first-party code is bundled directly into the package. Existing entry points (`rtcforge/client`, `rtcforge/server`, `rtcforge/media`, `rtcforge/filetransfer`) are unchanged, and the SFU cluster is now exposed via `rtcforge/sfu` and `rtcforge/sfu/udp`.

The `rtcforge-core`, `rtcforge-sdk`, `rtcforge-signaling`, `rtcforge-media`, and `rtcforge-sfu` packages are now private and are deprecated on npm. Install `rtcforge` instead.

`mediasoup` is now an optional peer dependency of `rtcforge` (only needed for server-side `rtcforge/media`).
