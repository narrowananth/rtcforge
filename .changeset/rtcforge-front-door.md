---
"rtcforge": patch
"rtcforge-core": patch
"rtcforge-sdk": patch
"rtcforge-signaling": patch
"rtcforge-media": patch
"rtcforge-sfu": patch
---

Position `rtcforge` as the single public entry point, and fix a real event bug found on the way.

- **sdk:** expose peer/broadcast events on `RoomEvent` — `PeerJoined`, `PeerLeft`, `PresenceOnline`, `PresenceOffline`, `Kicked`, `Signal`, `Broadcast`, `RoleChanged`. The documented `room.on(RoomEvent.PeerJoined, …)` API (in the README and BUILDING_APPS guide) previously resolved to `undefined` and never fired.
- **packaging:** `rtcforge` is now documented as the one package to install. The `rtcforge-*` packages are labeled internal building blocks (npm descriptions + README banners steer users to `rtcforge`). Removed the deprecated `rtcforge-adapter-udp` package (folded into `rtcforge-sfu/udp`).
