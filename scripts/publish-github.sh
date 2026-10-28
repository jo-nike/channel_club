#!/usr/bin/env bash
# Publish master and the release tags to the public GitHub mirror, with private
# hostnames and addresses rewritten throughout history.
#
#   scripts/publish-github.sh             rewrite a fresh clone, verify, push
#   scripts/publish-github.sh --dry-run   rewrite and verify only; keep the clone to inspect
#
# The rules live outside the repo (REPLACEMENTS, default
# ~/.config/channel-club/github-replacements.txt), one `literal==>replacement` per
# line, no comments: git filter-repo --replace-text reads every line as a rule. They
# apply to file contents and commit messages. Rewritten SHAs differ from Gitea's, so
# GitHub is publish-only: never push this checkout there directly. The rewrite is
# deterministic, so each run fast-forwards the previous one. Needs git-filter-repo.
set -euo pipefail

REPLACEMENTS="${REPLACEMENTS:-$HOME/.config/channel-club/github-replacements.txt}"
GITHUB_URL="${GITHUB_URL:-https://github.com/jo-nike/channel_club.git}"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -s "$REPLACEMENTS" ]] || { echo "No replacement rules at $REPLACEMENTS" >&2; exit 1; }
command -v git-filter-repo >/dev/null || { echo "git-filter-repo is not installed" >&2; exit 1; }

WORK="$(mktemp -d)"
$DRY_RUN || trap 'rm -rf "$WORK"' EXIT

git clone --quiet --no-local --single-branch --branch master "$ROOT_DIR" "$WORK/repo"
cd "$WORK/repo"
git filter-repo --quiet --force --replace-text "$REPLACEMENTS" --replace-message "$REPLACEMENTS"

# Refuse to push if any rule's original text survived in a blob, path or message.
PATTERNS="$WORK/patterns"
sed -e 's/==>.*//' -e 's/^literal://' "$REPLACEMENTS" | grep -v '^$' > "$PATTERNS"
# No grep -q: an early exit would SIGPIPE git log and, under pipefail, hide a match.
if { git log --all -p --format='%B'; git log --all --format= --name-only
     git tag -l --format='%(contents)'; } | grep -iFf "$PATTERNS" >/dev/null; then
  echo "Rewritten history still contains a replaced string; not pushing" >&2
  exit 1
fi

TAGS=$(git tag -l 'v*' | sed 's#^#refs/tags/#')
echo "Rewrote $(git rev-list --count master) commits; tags: $(git tag -l 'v*' | xargs)"
if $DRY_RUN; then
  echo "Dry run: inspect $WORK/repo, then delete it"
  exit 0
fi
# shellcheck disable=SC2086 # one ref per word
git push "$GITHUB_URL" refs/heads/master $TAGS
