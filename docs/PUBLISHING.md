# Publishing & Using RTCForge Packages

Single source for installing, publishing, and locally testing the RTCForge packages. Public registry, unscoped.

## Install

Most apps install the **`rtcforge`** meta-package and import from its subpaths:

| Import | Re-exports | Runtime |
| ------ | ---------- | ------- |
| `rtcforge/client` | `rtcforge-sdk` — `RTCForgeClient`, `createClient`, `Room` | browser |
| `rtcforge/media` | `rtcforge-media` — `Call`, `getUserMedia`, `MediaService` | browser + node |
| `rtcforge/filetransfer` | `rtcforge-sdk/filetransfer` — `FileTransferManager` | browser |
| `rtcforge/server` | `rtcforge-signaling` — `SignalingServer`, `createSignalingServer` | node |

```bash
npm i rtcforge                 # signaling + client (server / client / filetransfer)
npm i rtcforge rtcforge-media  # add audio/video (rtcforge/media) — optional peer dep
# ...plus `mediasoup` for the server-side SFU plane (optional peer of rtcforge-media)
```

Or cherry-pick individual packages:

| Package | Install | Entry point |
| ------- | ------- | ----------- |
| `rtcforge` | `npm i rtcforge` | `rtcforge/client`, `/server`, `/media`, `/filetransfer` |
| `rtcforge-core` | (transitive — never install directly) | primitives + scale primitives |
| `rtcforge-sdk` | `npm i rtcforge-sdk` | `RTCForgeClient` (+ `/filetransfer`) |
| `rtcforge-signaling` | `npm i rtcforge-signaling` | `SignalingServer` |
| `rtcforge-media` | `npm i rtcforge-media` (+ `mediasoup` for the SFU) | `Call`, `MediaService` |
| `rtcforge-sfu` | `npm i rtcforge-sfu` | `SfuCluster`, `rtcforge-sfu/udp` |
| `rtcforge-adapter-udp` | **deprecated** — use `rtcforge-sfu/udp` | `UdpGossipTransport` |

> **`mediasoup` is an optional peer dependency of `rtcforge-media`.** Browser-only
> consumers never download or compile the native addon; server-side SFU users add
> `mediasoup` explicitly. It is lazily imported, so importing `rtcforge-media`
> without it only fails when you actually spawn a worker.
>
> **`rtcforge-adapter-udp` has moved into `rtcforge-sfu/udp`.** The old package is a
> thin re-export kept for backwards compatibility.

---

## Publishing (maintainers)

Versioning and per-package `CHANGELOG.md` generation are driven by
[changesets](https://github.com/changesets/changesets); all `rtcforge`/`rtcforge-*`
packages are versioned in lockstep.

```bash
npm run changeset          # describe a change + pick a semver bump (per PR)
npm run version-packages   # apply pending changesets → bump versions + CHANGELOGs
npm run release            # build + `changeset publish` (normally run by CI)
```

On merge to `master`, `.github/workflows/release.yml` opens/updates a "Version
Packages" PR; merging it publishes to npm **with provenance** (`NPM_CONFIG_PROVENANCE`).
CI (`.github/workflows/ci.yml`) runs lint, typecheck, build, and tests on every PR.

---

## API reference docs

Class-level API docs for every package are generated with [TypeDoc](https://typedoc.org) from the TypeScript source (driven by the TSDoc comments in each package) and published to GitHub Pages.

```bash
npm run docs && npx serve docs-site         # build the site → docs-site/ (gitignored)
```
