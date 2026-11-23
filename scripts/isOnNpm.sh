#!/usr/bin/env bash
# Prints `true` when `flaneur@<version>` is on npm, `false` when npm answers that it is not. Any other
# npm failure (network, registry) fails the script, so an outage is never read as "not published".
# Used by .github/workflows/release.yml: `bash scripts/isOnNpm.sh <version>`.
set -euo pipefail

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT

if npm view "flaneur@$1" version > /dev/null 2> "$errors"; then
    echo true
elif grep -q 'E404' "$errors"; then
    echo false
else
    cat "$errors" >&2
    exit 1
fi
