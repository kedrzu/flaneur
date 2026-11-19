#!/usr/bin/env bash
# Checks a packed `flaneur` tarball before it is published: that what was tested is what npm users
# get. Run from the repo root with the tarball path: `bash scripts/checkPackedRelease.sh <tarball>`.
#
# 1. Every `@nzyme/*` package it depends on, directly or through another `@nzyme/*`, has the same source
#    in the pinned nzyme commit as in the nzyme release tag of its version. The tests ran on the pin;
#    npm serves the release, so the two must not differ.
# 2. The tarball installs from npm in an empty directory and its library and CLI load on Node. This
#    fails when a dependency version is not on npm.
set -euo pipefail

tarball=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")

# `name version` of each `@nzyme/*` dependency, collected transitively through the nzyme workspace.
pending=$(tar -xOzf "$tarball" package/package.json \
    | jq -r '.dependencies // {} | to_entries[] | select(.key | startswith("@nzyme/")) | .key')
seen=""
while [ -n "$pending" ]; do
    name=$(echo "$pending" | head -1)
    pending=$(echo "$pending" | tail -n +2)
    case " $seen " in *" $name "*) continue ;; esac
    seen="$seen $name"

    manifest="nzyme/packages/${name#@nzyme/}/package.json"
    if [ ! -f "$manifest" ]; then
        echo "::error::$name is not a package of the pinned nzyme ($manifest is missing)."
        exit 1
    fi
    pending=$(printf '%s\n%s' "$pending" \
        "$(jq -r '.dependencies // {} | keys[] | select(startswith("@nzyme/"))' "$manifest")" | sed '/^$/d')
done

status=0
for name in $seen; do
    dir="packages/${name#@nzyme/}"
    version=$(jq -r .version "nzyme/$dir/package.json")
    tag="v$version"
    if ! git -C nzyme rev-parse --verify --quiet "refs/tags/$tag" > /dev/null \
        && ! git -C nzyme fetch --quiet --depth=1 origin tag "$tag" 2> /dev/null; then
        echo "::error::$name $version has no nzyme release ($tag is not tagged): release nzyme first."
        status=1
    elif ! git -C nzyme diff --quiet "$tag" HEAD -- "$dir"; then
        echo "::error::The pinned nzyme changes $name since $tag: the tests ran on code npm does not serve as $name@$version. Pin an nzyme release."
        status=1
    else
        echo "✅ $name@$version matches $tag"
    fi
done
[ "$status" = 0 ] || exit 1

consumer=$(mktemp -d)
trap 'rm -rf "$consumer"' EXIT
cd "$consumer"
npm init -y > /dev/null
npm install --no-audit --no-fund --loglevel=error "$tarball"
node --input-type=module -e "await import('flaneur')"
./node_modules/.bin/flaneur --help > /dev/null 2>&1
echo "✅ flaneur installs from npm and loads on Node"
