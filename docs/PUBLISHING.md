# Publishing & Using RTCForge

Single source for installing, publishing, and locally testing RTCForge. One
published package (`rtcforge`), public registry, unscoped.

## Install

Install **`rtcforge`** and import each layer from a subpath. It has no
`rtcforge-*` dependencies — everything is bundled in.

```bash
npm i rtcforge                 # signaling server + client + P2P media + file transfer
npm i rtcforge mediasoup       # add the server-side SFU (mediasoup is an optional peer dep)
```

| Import | What you get | Runtime |
| ------ | ------------ | ------- |
| `rtcforge/server` | `SignalingServer`, `createSignalingServer`, `Room`, `Peer`, `RoomRouter` | node |
| `rtcforge/client` | `RTCForgeClient`, `createClient`, `Room`, `ClientEvent`, `RoomEvent` | browser + node |
| `rtcforge/media` | `Call`, `getUserMedia` (browser mesh) · `MediaService`, `SfuSignalHandler` (node SFU) | browser + node |
| `rtcforge/filetransfer` (+ `/node`) | `FileTransferManager`, sinks, `DataChannelHub` | browser / node |
| `rtcforge/sfu` (+ `/udp`) | `SfuCluster`, `HashRingStrategy`, `CascadeTree`, `UdpGossipTransport` | node |
| `rtcforge/core` | `EventEmitter`, `Logger`, `consoleLogger`, `HashRing`, `GossipMembership`, … | any |

> `rtcforge/media` resolves to a **mediasoup-free browser build** under a bundler's
> `browser` condition (P2P mesh) and to the full mediasoup server plane in node.
> `mediasoup` is an **optional peer dependency**, lazily imported — browser
> consumers never download or compile the native addon.
>
> The former `rtcforge-core`, `-sdk`, `-signaling`, `-media`, and `-sfu` packages
> are **deprecated** — their code is bundled into `rtcforge`. Do not install them.

---

## Publishing (maintainers)

Versioning and `CHANGELOG.md` generation are driven by
[changesets](https://github.com/changesets/changesets). Only `rtcforge` is
published; the sub-packages are `private`.

```bash
npm run changeset          # describe a change + pick a semver bump (per PR)
npm run version-packages   # apply pending changesets → bump version + CHANGELOG
npm run release            # build + `changeset publish` (normally run by CI)
```

On merge to `master`, `.github/workflows/release.yml` opens/updates a "Version
Packages" PR; merging **that** PR publishes `rtcforge` to npm with provenance.

### npm authentication — OIDC trusted publishing

CI publishes via **npm OIDC trusted publishing** — no long-lived `NPM_TOKEN`
secret. The workflow already has what it needs: `permissions.id-token: write`,
`npm install -g npm@latest` (OIDC needs npm ≥ 11.5.1), and
`NPM_CONFIG_PROVENANCE: "true"`.

The one manual, **one-time** step is on npmjs.org (it cannot be done from the
repo):

1. Sign in to npmjs.org as an owner of the `rtcforge` package.
2. Open the **`rtcforge`** package → **Settings** → **Trusted Publisher**.
3. Choose **GitHub Actions** and fill:
   - Organization or user: `narrowananth`
   - Repository: `rtcforge`
   - Workflow filename: `release.yml`
   - Environment: leave blank (the workflow declares no `environment:`)
4. Save. Re-run the Release workflow (or merge the Version Packages PR).

Without this, publishing fails with `E404 … 'rtcforge@x.y.z' could not be found
or you do not have permission` — npm received the OIDC identity but found no
matching trusted-publisher rule.

> **Token fallback (not recommended).** If you must use a token instead of OIDC:
> create a granular **Automation** token on npmjs.org with publish rights to
> `rtcforge`, add it as the repo secret `NPM_TOKEN`, and expose it to the publish
> step as **`NODE_AUTH_TOKEN`** (the name `setup-node`'s generated `.npmrc`
> references — `NPM_TOKEN` alone is ignored). Never paste a token into chat, a
> commit, or the workflow file.

---

## API reference docs

Class-level API docs are generated with [TypeDoc](https://typedoc.org) from the
TypeScript source (TSDoc comments) and published to GitHub Pages.

```bash
npm run docs && npx serve docs-site         # build the site → docs-site/ (gitignored)
```
