---
name: testing
description: >-
    Tests in flaneur — whether a change needs one and how bun unit and integration tests are written in
    packages/flaneur. Use before writing, changing or reviewing any *.test.ts.
---

# Testing

## Paths

- Unit and integration tests: `*.test.ts` beside the code, run by bun.

## Requirements

- `scripts/nxInputs.test.ts` guards the build cache; never delete it.

## Commands

- `bun run tests` (the affected tests), `bun run tests:full` (all); scoped forms in the `verify` skill.

Links in the document below are relative to `nzyme/docs/practice/`; package READMEs are `nzyme/packages/<pkg>/README.md`.

!`cat nzyme/docs/practice/testing.md`
