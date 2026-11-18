---
name: code-conventions
description: >-
    How TypeScript is written in flaneur — file organization and naming, function order, imports, casts, JSDoc,
    code that runs on Node and Bun. Use before writing, refactoring or reviewing any .ts file.
---

# Code conventions

## Paths

- The published package: `packages/flaneur/src/`; its CLI entry under `packages/flaneur/bin/`.
- Generated files, never edited by hand: every package's `tsconfig.json`, `*.loc.ts`.

## Requirements

- Runtime code runs on Node and Bun: Node-compatible APIs only, no `Bun.*` outside tests and `scripts/`
  (`ARCHITECTURE.md`, "Stack").
- `packages/flaneur` depends on no private workspace package (`ARCHITECTURE.md`, "Packages").

## Commands

- `bun run lint:check`, `bun run format` (Markdown too); the code map: `bun run index` (`INDEX.md`).

Links in the document below are relative to `nzyme/docs/practice/`; package READMEs are `nzyme/packages/<pkg>/README.md`.

!`cat nzyme/docs/practice/code-conventions.md`
