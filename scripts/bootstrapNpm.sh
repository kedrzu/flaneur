#!/usr/bin/env bash
# The one-off start of `flaneur` on npm, run by the maintainer from their own machine: after it, every
# release is a pushed tag (.github/workflows/release.yml), published through npm trusted publishing.
#
# npm configures a trusted publisher only for a package that exists, so the first version cannot come
# from the workflow. This script, asking before each step and skipping a step that is already done:
#
# 1. checks, packs and publishes the version in packages/flaneur/package.json from `origin/main`,
#    with the same checks as the workflow (typecheck, all tests, scripts/packRelease.sh);
# 2. makes `kedrzu/flaneur` / `release.yml` its trusted publisher (`npm trust github`);
# 3. tags the commit `v<version>` and pushes the tag. The release workflow then runs on it and skips
#    the publish, since the version is on npm already.
#
# Run from the repo root, after `npm login` with an account that has two-factor authentication:
# `bash scripts/bootstrapNpm.sh`. npm asks for the second factor in the terminal or the browser on the
# publish and on the trust step. The locally published version carries no provenance: that needs CI.
set -euo pipefail

PACKAGE=flaneur
REPOSITORY=kedrzu/flaneur
WORKFLOW=release.yml

# `npm trust` needs npm 11.10 or later; npm 12 no longer runs on every Node 23 or 25.
npm() {
    npx --yes npm@11 "$@"
}

confirm() {
    local answer
    read -r -p "$1 [y/N] " answer
    [[ "$answer" =~ ^[Yy](es)?$ ]]
}

fail() {
    echo "❌ $1" >&2
    exit 1
}

version=$(jq -r .version packages/flaneur/package.json)
tag="v$version"

git fetch --quiet origin main --tags
[ -z "$(git status --porcelain)" ] || fail "The working tree is not clean."
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
    || fail "HEAD is not origin/main: run it from a checkout of origin/main (git switch --detach origin/main)."
user=$(npm whoami 2> /dev/null) || fail "Not logged in to npm: run \`npm login\` first."
echo "npm user: $user · $PACKAGE@$version · $(git rev-parse --short HEAD)"

# 1. The first publish.
if [ -n "$(npm view "$PACKAGE@$version" version 2> /dev/null)" ]; then
    echo "✅ $PACKAGE@$version is on npm"
elif confirm "Typecheck, test, pack and publish $PACKAGE@$version from this machine?"; then
    bun run typecheck
    bun run tests:full
    tarball=$(bash scripts/packRelease.sh "$(mktemp -d)" | tail -1)
    npm publish "$tarball" --access public
    echo "📦 $PACKAGE@$version"
else
    fail "Skipped: $PACKAGE must be on npm before it can get a trusted publisher."
fi

# 2. The trusted publisher. Reading npm's trust configuration costs a second factor too, so the script
# only skips this step when a version was already published through a trusted publisher.
if curl -fsS "https://registry.npmjs.org/$PACKAGE/latest" | jq -e '._npmUser.trustedPublisher' > /dev/null; then
    echo "✅ $PACKAGE publishes through a trusted publisher"
elif confirm "Make $REPOSITORY / $WORKFLOW the trusted publisher of $PACKAGE?"; then
    npm trust github "$PACKAGE" --repository "$REPOSITORY" --file "$WORKFLOW" --allow-publish --yes
    echo "🔐 $REPOSITORY / $WORKFLOW publishes $PACKAGE"
fi

# 3. The tag.
if git ls-remote --exit-code --tags origin "refs/tags/$tag" > /dev/null; then
    echo "✅ $tag is on origin"
elif confirm "Tag $(git rev-parse --short HEAD) as $tag and push the tag?"; then
    git tag "$tag"
    git push origin "$tag"
    echo "🏷  $tag: the release workflow runs on it and skips the publish"
fi
