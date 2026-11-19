# flaneur architecture

flaneur is a stealth Chrome for AI agents over the Chrome DevTools Protocol (CDP): a library and a CLI
that launch Chrome, route it through a proxy and present it so that sites treat the agent like a person
browsing. It is an open-source npm package, `flaneur`, used by agents and the apps that host them; it
runs on Node and on Bun. There is no app, server or database: the repo builds, tests and publishes one
package.

## Stack

- **Runtime and package manager:** Bun, with Bun workspaces, for the repo's tooling. The published
  package runs on Node and Bun alike, so its runtime code uses Node-compatible APIs only.
- **Language:** TypeScript, ESM.
- **Framework packages:** `@nzyme/*` (dependency injection, logging, utilities), built from source from
  the `nzyme/` git submodule. In the published package they are ordinary npm dependencies at the
  versions of the pinned nzyme commit.
- **Build orchestration:** Nx, cache scoped to each worktree.
- **Design:** none; flaneur has no UI.

## Packages

- **`flaneur`** — `packages/flaneur`: the library (launch, proxy, CDP session) and the CLI, published to
  npm. It must not depend on a private workspace package, since npm users could not install it.

Any later internal package is private and named `@flaneur/<package>` in `packages/<package>`.

The repo is also a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) with one plugin in `plugin/`:
the `flaneur` skill that teaches an agent to run the CLI and drive it with agent-browser. It is not a workspace
package and is not published to npm; Claude Code installs it from GitHub. Its `version` follows the package's.

## Tooling and workflow

- **Setup:** `zsh setup.sh` — submodule, install, generated files, build; run for every clone and
  worktree. `setup.build.sh` is its build half, which CI runs too.
- **Checks:** `bun run typecheck`, `bun run lint:check`, `bun run format:check` and `bun run tests`
  (`tests:full` for every test). CI runs all four, with `tests:full`, on every pull request
  (`.github/workflows/build.yml`, required check `Build`).
- **Release:** pushing a `v*` tag runs `.github/workflows/release.yml`: build, typecheck, tests, then
  `bun pm pack` (which rewrites `workspace:*` to real versions) and `npm publish --provenance` of that
  tarball through npm trusted publishing (OIDC). A manual dispatch publishes the version in
  `packages/flaneur/package.json`.
- **Git:** one branch and one pull request per change, squash-merged to `main`, Conventional Commits
  (`.claude/skills/git-workflow/SKILL.md`). The nzyme pin moves with every task: `setup.sh` moves it in each worktree
  to the latest nzyme release, and the task's PR carries the bump. `.github/workflows/verify-submodules.yml`
  checks that every pin is on nzyme `main`.
- **Agents:** `CLAUDE.md`, the skills under `.claude/skills/`.

## Decisions

- **The one public package is unscoped `flaneur`, not `@flaneur/flaneur`.** `flaneur` is the product's
  npm name and what users install; the `@flaneur` scope is kept for private, internal packages.
- **The repo is a library and a CLI only: no Nuxt app, UI package, e2e or database.** flaneur has no
  screens; its users are programs.
- **`rollup` is pinned to 4.62.2 in the root `overrides`.** nzyme's `@nzyme/pulumi` does not type-check
  against rollup 4.68 (its plugin types no longer match `rollup-plugin-stats`), and the workspace builds
  every nzyme package. Drop the override once nzyme builds against current rollup.
- **No scheduled nzyme bump; `setup.sh` moves the pin to the latest nzyme release in every worktree.** The published
  `flaneur` depends on the `@nzyme/*` versions of the pin, so the pinned code must be what npm serves under those
  versions: a pin on unreleased nzyme `main` would be tested against code no user installs. Bumping in each task keeps
  the pin current, and the agent fixes what a new release breaks inside that task's PR. A pin ahead of the latest
  release (an nzyme change the package needs) is allowed, but `flaneur` is not published until nzyme releases it.
