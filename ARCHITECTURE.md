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
- **`@flaneur/eval`** — `packages/eval`, private: measures how detectable flaneur is against a headless control and a
  person (`bun run eval`). Its test shop, `packages/eval/shop`, is static HTML deployed to GitHub Pages by
  `.github/workflows/pages.yml`; it is linted by nothing, since it is untyped browser JS outside the build.
- **`@flaneur/chrome-extension`** — `packages/chrome-extension`, private: the Chrome extension behind `--chrome own`, which lets
  flaneur drive the user's own Chrome through `chrome.debugger` over native messaging (the protocol is
  `OwnChromeProtocol.ts` in `flaneur`). `tsgo --build` only checks it; `bun run build` then bundles each entry
  (service worker, options page) into `dist/`, since an extension cannot load a bare `import 'flaneur'`. The package
  directory is the unpacked extension (`--load-extension=packages/chrome-extension`); its manifest carries the Chrome
  Web Store item's public `key`, so the unpacked build has the store's ID, the one the native host admits. `bun run --cwd packages/chrome-extension pack` zips it for the Chrome Web Store,
  without the key. Its defaults are read from `defaults.json` at run time, so a test loads a copy with its own.

Any later internal package is private and named `@flaneur/<package>` in `packages/<package>`.

The repo is also a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) with one plugin in `plugin/`:
the `flaneur` skill that teaches an agent to run the CLI and drive it with agent-browser. It is not a workspace
package and is not published to npm; agents install it from GitHub. Codex reads the same Claude Code marketplace and
manifest, so it has none of its own. OpenCode has no plugin marketplace: `plugin/skills/index.json` makes the skills
folder an OpenCode skill catalog, fetched from `raw.githubusercontent.com` on `main`. The plugin's `version` and each
catalog entry's follow the package's (`scripts/pluginVersions.test.ts`); OpenCode refreshes its cached copy only when
the entry's `version` changes, so the skill reaches OpenCode users with a release.

## Tooling and workflow

- **Setup:** `zsh setup.sh` — submodule, install, generated files, build; run for every clone and
  worktree. `setup.build.sh` is its build half, which CI runs too.
- **Checks:** `bun run typecheck`, `bun run lint:check`, `bun run format:check` and `bun run tests`
  (`tests:full` for every test). CI runs all four, with `tests:full`, on every pull request
  and every push to `main` (`.github/workflows/build.yml`, required check `Build`).
- **Release:** one manual run of `.github/workflows/release.yml` on `main`, whose header comment is the full
  description. It sets the version (`scripts/bumpVersion.ts`) and commits it on the runner; builds, typechecks and
  tests that commit; packs it with `scripts/packRelease.sh` (`bun pm pack`, which rewrites `workspace:*` to real
  versions, and `scripts/checkPackedRelease.sh`: the pinned `@nzyme/*` source equals each package's nzyme release tag,
  and the tarball installs from npm and loads on Node). It then pushes the release commit and the `v<version>` tag to
  `main` in one atomic push, publishes the tarball with `npm publish --provenance` through npm trusted publishing
  (OIDC), and creates the GitHub Release. A red run before the push leaves nothing behind; a tag with no package on npm
  is a release to finish, which a re-run or a new dispatch does without publishing twice. The push uses a deploy key,
  the only bypass actor of the rulesets on `main` and on `v*` tags (`GITHUB_TOKEN` cannot be one). Provenance records
  the run's commit, not the tag. npm accepts a trusted publisher only for an existing package, so the first version
  was published from the maintainer's machine by `scripts/bootstrapNpm.sh`.
- **Git:** one branch and one pull request per change, squash-merged to `main`, Conventional Commits
  (`.claude/skills/git-workflow/SKILL.md`). A ruleset makes the pull request and the `Build` check mandatory on `main`. The nzyme pin moves with every task: `setup.sh` moves it in each worktree
  to the latest nzyme release, and the task's PR carries the bump. `.github/workflows/verify-submodules.yml`
  checks that every pin is on nzyme `main` and is the commit of a release tag.
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
  the pin current, and the agent fixes what a new release breaks inside that task's PR. The pin is always an nzyme release
  tag, enforced by `verify-submodules.yml`: an nzyme change the package needs is released in nzyme first, then pinned.
