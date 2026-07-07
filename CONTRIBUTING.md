# Contributing to RTCForge

Thanks for taking the time to contribute. This guide covers everything you need to propose a change.

## Ground rules

- Be respectful — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Open an issue before large changes so we can agree on direction.
- Keep PRs focused: one logical change per PR.

## Project layout

RTCForge is a monorepo. `rtcforge` is the only **published** package; the other `packages/*` are internal modules bundled into it. See [Project Structure](README.md#project-structure) and [`docs/BUILDING_APPS.md`](docs/BUILDING_APPS.md).

## Development setup

```bash
git clone https://github.com/narrowananth/rtcforge.git
cd rtcforge
npm install          # installs workspaces + Husky hooks
```

**Requirements:** Node.js `>= 18`, npm `>= 9`.

## Common commands

Run from the repo root (apply to all packages):

| Command             | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `npm test`          | Unit tests (Vitest)                            |
| `npm run build`     | Build all packages (tsup → CJS + ESM + `.d.ts`)|
| `npm run typecheck` | Type-check without emitting                    |
| `npm run check`     | Lint + format check (Biome)                    |
| `npm run check:fix` | Auto-fix lint + format                         |
| `npm run test:e2e`  | Real-browser E2E (needs Playwright chromium)   |

Target one package: `npm test --workspace=packages/sdk`.

## Making a change

1. **Branch** off `master`: `git checkout -b feat/my-change`.
2. **Code.** Match the surrounding style — Biome enforces formatting on commit.
3. **Test.** Add or update tests; `npm test` must pass. For runtime-facing changes, exercise the affected flow.
4. **Typecheck + lint:** `npm run typecheck && npm run check`.
5. **Changeset** — record your change so it lands in the CHANGELOG and version bump:

   ```bash
   npm run changeset
   ```

   Pick the affected package(s) and a semver bump (patch / minor / major). PRs with a user-facing change **must** include a changeset.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Keep the subject ≤ 50 chars.

## Pull requests

- Fill in the [PR template](.github/pull_request_template.md).
- CI (build, typecheck, lint, tests) must be green.
- A maintainer reviews and merges; `master` is protected.

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/narrowananth/rtcforge/issues/new/choose). Include RTCForge version, Node version, and a minimal reproduction.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
