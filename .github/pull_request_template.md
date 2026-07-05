<!--
Branch flow:
  feature/*  --PR-->  dev   (this PR should target `dev`)
  dev        --PR-->  master (release; publishes npm + GitHub Pages on merge)
Only target `master` for a release PR from `dev`.
-->

## What

<!-- One-line summary of the change. -->

## Why

<!-- Context / linked issue. -->

## Changes

-

## Checklist

- [ ] Base branch is correct (`dev` for features, `master` only for releases from `dev`)
- [ ] `npm run check` / `typecheck` / `test` pass locally
- [ ] Added/updated a changeset (`npx changeset`) if this changes a published package
- [ ] Docs/README updated if behavior changed
