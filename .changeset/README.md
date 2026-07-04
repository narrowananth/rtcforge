# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
It drives versioning and per-package `CHANGELOG.md` generation.

Add a changeset for any user-facing change:

```bash
npx changeset          # describe the change + pick a semver bump
```

On merge to `master`, the release workflow (`.github/workflows/release.yml`)
opens/updates a "Version Packages" PR; merging that publishes to npm with
provenance. All `rtcforge`/`rtcforge-*` packages are versioned in lockstep
(see `fixed` in `config.json`).
