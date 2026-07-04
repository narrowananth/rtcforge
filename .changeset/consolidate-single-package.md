---
"rtcforge": minor
---

Consolidate into a single self-contained package. `rtcforge` no longer depends on `rtcforge-sdk`, `rtcforge-signaling`, or `rtcforge-media` — all first-party code is now bundled directly into the package. The public import surface is unchanged (`rtcforge/client`, `rtcforge/server`, `rtcforge/media`, `rtcforge/filetransfer`).

The `rtcforge-core`, `rtcforge-sdk`, `rtcforge-signaling`, `rtcforge-media`, and `rtcforge-sfu` packages are now private and are being deprecated + unpublished from npm. Install `rtcforge` instead.

`mediasoup` is now an optional peer dependency of `rtcforge` (only needed for server-side `rtcforge/media`).
