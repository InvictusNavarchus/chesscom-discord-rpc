#!/usr/bin/env bash
#
# Stamp a new version across the files that carry one, then commit and tag.
#
#   ./bump.sh 0.2.0
#
# Local only: it does not push or publish. Review, then run the commands it
# prints. To undo before pushing:
#
#   git tag -d vX.Y.Z && git reset --hard HEAD~1

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYPROJECT="$REPO_ROOT/server/pyproject.toml"
USERSCRIPT="$REPO_ROOT/userscript/package.json"
LOCKFILE="$REPO_ROOT/server/uv.lock"

if [[ -t 1 ]]; then
    R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
else
    R=''; G=''; Y=''; B=''; N=''
fi

info() { printf '%s==>%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%swarn:%s %s\n' "$Y" "$N" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

case "${1-}" in
    "")        die "usage: ./bump.sh <version>   e.g. ./bump.sh 0.2.0" ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
esac

NEW="$1"
TAG="v$NEW"

[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] \
    || die "'$NEW' is not a semver version (expected N.N.N, optionally -suffix)."

cd "$REPO_ROOT"

# --- Preconditions ----------------------------------------------------------

# A dirty tree would let unrelated edits ride along in the release commit,
# which is exactly the contamination a release commit must not have.
git diff --quiet && git diff --cached --quiet \
    || die "working tree is not clean. Commit or stash first:
$(git status --short | sed 's/^/       /')"

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
    && die "tag $TAG already exists."

for f in "$PYPROJECT" "$USERSCRIPT"; do
    [[ -f "$f" ]] || die "missing file: $f"
done

# --- Read and cross-check the current version -------------------------------

cur_py=$(sed -n 's/^version = "\(.*\)"$/\1/p' "$PYPROJECT")
cur_us=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$USERSCRIPT")

[[ -n "$cur_py" ]] || die "could not read version from $PYPROJECT"
[[ -n "$cur_us" ]] || die "could not read version from $USERSCRIPT"

# If these have already drifted, something went wrong earlier; overwriting
# would hide it.
[[ "$cur_py" == "$cur_us" ]] \
    || die "versions are already out of sync -- fix by hand first.
       pyproject.toml: $cur_py
       package.json:   $cur_us"

[[ "$cur_py" != "$NEW" ]] || die "already at $NEW."

# Not fatal: re-releasing downward is occasionally deliberate.
if [[ "$(printf '%s\n%s\n' "$cur_py" "$NEW" | sort -V | tail -1)" != "$NEW" ]]; then
    warn "$NEW sorts below the current $cur_py."
fi

info "Bumping ${B}$cur_py${N} -> ${B}$NEW${N}"

if git describe --tags --abbrev=0 >/dev/null 2>&1; then
    last=$(git describe --tags --abbrev=0)
    printf '\n  Commits since %s:\n' "$last"
    git log --oneline "$last..HEAD" | sed 's/^/    /'
    printf '\n'
fi

# --- Rewrite ----------------------------------------------------------------

sed -i "s|^version = \".*\"|version = \"$NEW\"|" "$PYPROJECT"
sed -i "s|^\([[:space:]]*\"version\":[[:space:]]*\"\)[^\"]*\(.*\)|\1$NEW\2|" "$USERSCRIPT"

# Read back rather than trusting sed's exit status, which is 0 on no-match.
[[ "$(sed -n 's/^version = "\(.*\)"$/\1/p' "$PYPROJECT")" == "$NEW" ]] \
    || die "failed to rewrite the version in $PYPROJECT"
[[ "$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$USERSCRIPT")" == "$NEW" ]] \
    || die "failed to rewrite version in $USERSCRIPT"

# Build userscript artifact for release
if command -v bun >/dev/null 2>&1; then
    (cd "$REPO_ROOT/userscript" && bun run build)
elif command -v pnpm >/dev/null 2>&1; then
    (cd "$REPO_ROOT/userscript" && pnpm run build)
elif command -v npm >/dev/null 2>&1; then
    (cd "$REPO_ROOT/userscript" && npm run build)
elif command -v yarn >/dev/null 2>&1; then
    (cd "$REPO_ROOT/userscript" && yarn build)
else
    die "no JavaScript package manager found (bun, pnpm, npm, or yarn required to build release artifact)."
fi

[[ -f "$REPO_ROOT/userscript/dist/chesscom-rpc-exporter.user.js" ]] \
    || die "userscript release artifact was not built."


# uv.lock records the project's own version, so it goes stale on every bump.
if command -v uv >/dev/null 2>&1; then
    (cd "$REPO_ROOT/server" && uv lock --quiet)
else
    warn "uv not found; $LOCKFILE still records $cur_py."
fi

# --- Commit and tag ---------------------------------------------------------

# Explicit paths: never stage by sweeping.
git add "$PYPROJECT" "$USERSCRIPT"
if [[ -f "$LOCKFILE" ]]; then
    git add "$LOCKFILE"
fi

printf '  Staged:\n'
git diff --cached --stat | sed 's/^/  /'
printf '\n'

git commit -q -m "chore(release): $TAG"
git tag -a "$TAG" -m "$TAG"

info "${B}Committed and tagged $TAG.${N}"
printf '\n'
printf '  Publish:  git push origin master %s\n' "$TAG"
printf '            gh release create %s userscript/dist/chesscom-rpc-exporter.user.js --generate-notes\n' "$TAG"
printf '\n'
printf '  Undo (before pushing):\n'
printf '            git tag -d %s && git reset --hard HEAD~1\n' "$TAG"
