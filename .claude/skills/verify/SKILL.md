---
name: verify
description: >-
    How a change is proven to work in flaneur — a scoped check after each step of work and the full protocol before a
    change is called done (codegen, TypeScript, lint, format, bun tests). The dev pipeline (/dev:*) relies on it; reach
    for it whenever you need to check that the repo is green, before committing a finished change, or when asked to
    "verify", "make it green" or "run the checks".
---

# verify — flaneur

Fulfils the `verify` contract of the `dev` plugin (`skills/pipeline/references/contracts.md`).

All commands run from the repo root; wrap each in `bun nzyme quiet-run`. If `nzyme/packages/cli/dist` is missing (fresh
clone or worktree), run `zsh setup.sh` first. Nothing needs local infrastructure or secrets.

## Scoped

After each piece of work, while more remains. Covers what the change touched; green here is **not** a green codebase.

|Check|Command|When|
|-|-|-|
|Generated files|`bun run codegen`|a package was added or its dependencies changed|
|TypeScript|`bun run build`|always (incremental)|
|Lint|`bun run lint:check`|always (whole repo, fast)|
|Format|`bun x oxfmt --disable-nested-config <changed files>`; Markdown: `bun x eslint --fix <changed .md>`|always|
|Tests|`bun run tests` (the tests the change can reach); one package: `TZ=UTC bun test --timeout 10000 ./packages/<pkg>/src` — always with `./`, a bare path is a name filter|a `*.test.ts` or the code it covers changed|

## Full

Once, when all work is believed complete. Every step, in order, nothing skipped; zero errors each.

A change whose `git diff --name-only origin/main...HEAD` lists only `.md` files and files under `docs/` has nothing to
break but the format: `bun run lint` and `bun run format` alone are the full protocol.

|#|Step|Command|Must|
|-|-|-|-|
|1|Codegen|`bun run codegen`|regenerates tsconfigs cleanly; `git status` shows no unexpected diff|
|2|Typecheck|`bun run typecheck`|zero errors (build, `scripts/`, each package's `typecheck`)|
|3|Lint|`bun run lint`|zero errors (applies fixes, Markdown formatting included)|
|4|Format|`bun run format`, then `bun run format:check`|applied, check clean|
|5|Tests|`bun run tests:full`|zero failures (includes the Nx inputs guard, `scripts/nxInputs.test.ts`)|

Rules:

- **Every red is yours** until proven otherwise; fix it, never skip, suppress or disable.
- **Rewind:** a fix that touches code an earlier step checked sends the run back to that step, then forward again.
- Step 5 runs the Nx inputs guard, which briefly edits the working tree; never run it alongside a build.
- Changes inside `nzyme/` additionally need `bun run lint:nzyme` and nzyme's own tests (`bun run --cwd nzyme test`).

## Where the checks run

On a pull request CI runs `.github/workflows/build.yml`: the job `Build` runs `setup.build.sh`, then steps 2-5 (checks
only, no fixes), plus `Verify Submodules` on the nzyme pin. The release workflow (`.github/workflows/release.yml`) runs
the build, typecheck and tests again before it publishes.
