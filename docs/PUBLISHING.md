# Publishing & Using RTCForge Packages

Single source for installing, publishing, and locally testing every `rtcforge-*` package. Public registry, unscoped, prefixed `rtcforge-`.

| Package | Install | Entry point |
| ------- | ------- | ----------- |
| `rtcforge-core` | (transitive — never install directly) | primitives + scale primitives |
| `rtcforge-sdk` | `npm i rtcforge-sdk` | `RTCForgeClient` |
| `rtcforge-signaling` | `npm i rtcforge-signaling` | `SignalingServer` |
| `rtcforge-media` | `npm i rtcforge-media rtcforge-core rtcforge-sdk rtcforge-signaling` | `Call`, `MediaService` |
| `rtcforge-sfu` | `npm i rtcforge-sfu` | `SfuCluster` |
| `rtcforge-adapter-udp` | `npm i rtcforge-adapter-udp` | `UdpGossipTransport` |

> `rtcforge-media` peer deps are **not** auto-installed. Everything else pulls `rtcforge-core` transitively.

---

## API reference docs

Class-level API docs for every package are generated with [TypeDoc](https://typedoc.org) from the TypeScript source (driven by the TSDoc comments in each package) and published to GitHub Pages.

```bash
npm run docs && npx serve docs-site         # build the site → docs-site/ (gitignored)
```