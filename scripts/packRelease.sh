#!/usr/bin/env bash
# Packs `flaneur` (packages/flaneur) for publishing and checks the tarball: no `workspace:` dependency
# is left, and scripts/checkPackedRelease.sh passes. Shared by the release workflow and
# scripts/bootstrapNpm.sh, so a tarball published from a laptop passes the same guards as one from CI.
#
# Run from the repo root after a build: `bash scripts/packRelease.sh <directory>`. The checks report on
# stderr; the last line on stdout is the tarball's path.
set -euo pipefail

destination=$(cd "$1" && pwd)

# `bun pm pack` rewrites `workspace:*` to the exact versions of the pinned nzyme packages.
packed=$(cd packages/flaneur && bun pm pack --quiet --destination "$destination" | tail -1)
tarball="$destination/$(basename "$packed")"

if tar -xOzf "$tarball" package/package.json | grep -q '"workspace:'; then
    echo "::error::The packed package.json still has a workspace: dependency." >&2
    exit 1
fi

bash scripts/checkPackedRelease.sh "$tarball" >&2

echo "$tarball"
