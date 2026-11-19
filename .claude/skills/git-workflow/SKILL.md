---
name: git-workflow
description: >-
    How a change moves in flaneur — one task, one Paseo worktree, one branch, one PR; kept up to date with main by
    merging, squash-merged on the owner's word; Conventional Commits; GitHub Issues as the tracker, stacked PRs through
    GitHub's native stacks; releases by tag — all through git and `gh`. The dev pipeline (/dev:*) relies on it; reach
    for it whenever you open a branch, commit, push, catch up with main, open or describe a PR, build a PR stack, merge
    or release.
---

# git-workflow — flaneur

Fulfils the `git-workflow` contract of the `dev` plugin (`skills/pipeline/references/contracts.md`).

Facts this rests on (checked 2026-11-18):

- Remote `origin` = `https://github.com/kedrzu/flaneur.git` (public), main line `main`; `gh` is logged in as `kedrzu`.
- `main` takes changes through pull requests only. `.claude/git.json` lists it in `protectedBranches`, so the `git`
  plugin's hook blocks an agent's push to it. On GitHub, `Build` (`.github/workflows/build.yml`) is the merge gate.
- Tracker: GitHub Issues in the same repository. A task may have no issue.
- Commit messages, PR titles, PR descriptions, issues and issue comments are in English.
- Branch names: `<type>/<slug>`, with an issue `<type>/<N>-<slug>` (`feat/12-proxy-auth`).
- `nzyme` is a git submodule (`https://github.com/kedrzu/nzyme.git`, no `branch =`); the gitlink is the pin.

## Titles

Conventional Commits: `<type>[(scope)][!]: <description>`, a lowercase imperative description, in English:
`feat: launch chrome with a persistent profile`, `fix: keep the proxy alive across navigations`.

The **PR title** is what counts: the squash makes it the commit on `main`. Commits on a branch use the same form, but
they vanish in the squash. Update the title when the PR's scope changes.

- Types: `feat` (something new a user of the package can do), `fix` (a user-visible defect), `perf`; `refactor`,
  `docs`, `test`, `build`, `ci`, `chore` for everything else.
- A scope is optional and names the area the change is confined to (`cli`, `proxy`).
- `!` after the type or scope (`feat!:`) marks a breaking change to the published API or CLI.

## Start

Paseo cuts the worktree's branch from `origin/main`, and its setup (`paseo.json` → `setup.sh`) has already merged
`origin/main` into it, copied the local files from the main checkout, checked out the pinned nzyme, moved it to the
latest nzyme release and built the workspace. A moved pin belongs to the task's PR: commit it with `bun.lock`, and fix
what the new nzyme breaks as part of the change.

1. As soon as the task is known, rename the generated branch before its first push: `git branch -m <type>/<N>-<slug>`.
   Find or create the issue first, when the task has one:
   ```bash
   gh issue view <N>
   gh issue create --title "<title>" --body "<description>"   # prints the URL with the number
   ```
2. No draft PR at start: the PR opens at the first push (Publish).

Not in a fresh worktree: `git fetch origin main` and `git switch -c <type>/<N>-<slug> origin/main --no-track`. In the
main checkout other sessions may share the directory, so ask once before switching branches there.

## Sync

At least **before every push and before Land**:

```bash
git fetch origin main
git log --oneline HEAD..origin/main     # anything listed → merge
git merge --no-edit origin/main
```

Merge, never rebase or force-push: review comments keep their anchors, and the merge commits vanish in the squash. In a
stack only the bottom node merges `main` (Stack). After a merge that moved the `nzyme` gitlink, `bun.lock` or a
`package.json`, rerun `zsh setup.sh`. Resolve conflicts with the `git` plugin's `fix-conflicts` skill; regenerate
`bun.lock` (`bun install`) and tsconfigs (`bun run monorepo`) rather than hand-merging them. Then the full `verify`, and
commit the merge.

## Checkpoint

Commit everything that belongs to the change and push:

```bash
git add -A
git status --short          # nothing unrelated staged
git commit -F - <<'EOF'
<type>[(scope)]: <imperative summary>

<why, when the subject does not say it>

<attribution trailer the session gives, if any>
EOF
git push -u origin HEAD     # first push; later just `git push`
```

**Confirm it landed:** `git status --porcelain` prints nothing and `git rev-parse HEAD` equals `git rev-parse @{u}`.

- **Only a given set of files:** `git restore --staged :/` (empty the index), then `git add -- <file1> <file2> …`;
  `git diff --cached --name-only` must list exactly that group; `git commit`. Repeat per group.
- **Push what is already committed:** `git push` (no commit), then confirm as above.
- **Push rejected** (the remote branch moved): `git pull --no-rebase`, then push again. Never `--force`.
- **Submodule (`nzyme`) moved:** the nzyme commit must be on `kedrzu/nzyme` before the flaneur commit that pins it is
  pushed — push the nzyme branch first (`git -C nzyme push -u origin HEAD`) and open its PR there (its own conventions:
  `nzyme/CLAUDE.md`). A flaneur PR may not land while its pin is reachable only from an nzyme feature branch: it must be
  on nzyme `main` (`nzyme/docs/consumers.md`; `Verify Submodules` fails otherwise).

## Publish

PRs open ready for review, not as drafts, at the first push of the branch. The pipeline supplies the texts.

- **No PR for the branch** (`gh pr view` fails):
  ```bash
  gh pr create --base main --title "<type>[(scope)]: <description>" --body-file - <<'EOF'
  <what changed and why>

  Closes #<N>

  <attribution line the session gives, if any>
  EOF
  ```
  `Closes #<N>` only when the branch has an issue; keep that line whenever the body is rewritten.
- **PR exists:** read the body with `gh pr view --json body --jq .body`, write the new one with
  `gh pr edit --body-file - <<'EOF' … EOF`; `gh pr edit --title "…"` when the scope changed.
- **A draft exists anyway:** `gh pr ready`.
- **Issue:** the number in the branch name and in `Closes #<N>`; `gh issue comment <N> --body-file <file>` posts the
  summary. No issue → no comment, say so in the hand-off.
- End with the PR URL: `gh pr view --json url --jq .url`.

## Stack

GitHub's native stacked pull requests, driven through `gh api`. Node 1 is the task branch; node `k` is `<branch>-<k>`.

- **Read the chain:**
  ```bash
  gh api "repos/kedrzu/flaneur/stacks?pull_request=<any node>" \
    --jq 'if length == 0 then "not stacked" else .[0] | .number, (.pull_requests[] | "\(.number) \(.head.ref) \(.state)") end'
  ```
- **Add a node** on top of node `k`, which must be committed and pushed:
  ```bash
  git switch -c <branch>-<k+1>
  # commit the node's changes (Checkpoint), then:
  git push -u origin HEAD
  gh pr create --base <branch of node k> --title "…" --body "Part <k+1> of <n>; previous: #<PR of node k>."
  # the first extra node creates the stack, bottom first; later ones append:
  echo '{"pull_requests":[<pr 1>,<pr 2>]}' | gh api -X POST repos/kedrzu/flaneur/stacks --input -
  echo '{"pull_requests":[<new pr>]}' | gh api -X POST repos/kedrzu/flaneur/stacks/<stack>/add --input -
  ```
- **Check out the tip / node `k`:** `git switch <branch of that node> && git pull --no-rebase`.
- **Propagate an edit to a lower node** without force-pushing: commit and push it on node `k`, then for each node above,
  in order: `git switch <node k+1> && git merge --no-edit <node k> && git push`.
- **Catching up with `main`:** Sync on the bottom node only, then propagate upward.
- **Must stay in the bottom node:** a moved `nzyme` gitlink, `package.json` / `bun.lock` changes later nodes depend on.
- **Landing a stack:** the whole chain at once — Land. Never merge a mid-stack PR in the GitHub UI.

## Land

Only on the owner's word — it is irreversible and lands on `main`.

1. Sync, the full `verify`, push; the PR must be out of draft and `Build` green (`gh pr checks <PR>`).
2. List unresolved review threads and act on each one or bring it to the owner:
   ```bash
   gh api graphql -f query='{repository(owner:"kedrzu",name:"flaneur"){pullRequest(number:<PR>){reviewThreads(first:100){nodes{isResolved path line comments(first:1){nodes{body}}}}}}}' \
     --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)'
   ```
3. Merge:
   - **One PR:** `gh pr merge <PR> --squash --delete-branch --match-head-commit "$(git rev-parse HEAD)"`.
   - **A stack:** merge the **top** PR asynchronously; GitHub lands it and every node below, one squash commit each:
     ```bash
     uuid=$(echo '{"merge_method":"squash"}' \
       | gh api -X PUT repos/kedrzu/flaneur/pulls/<top PR>/merge-async --input - --jq .uuid)
     gh api repos/kedrzu/flaneur/pulls/<top PR>/merge-async/$uuid --jq .status   # poll until not pending
     ```
4. `gh pr view <PR> --json state,mergeCommit` confirms `MERGED`.

## Release

Only on the owner's word — it publishes to npm, which cannot be undone.

1. A PR (`chore(release): v<version>`) sets `version` in `packages/flaneur/package.json`; it lands like any other.
2. Tag the merged commit and push the tag; `.github/workflows/release.yml` builds, tests and publishes:
   ```bash
   git fetch origin main
   git tag v<version> origin/main
   git push origin v<version>
   gh run list --workflow release.yml --limit 1
   ```
   The workflow refuses a tag that does not match the package's version.
