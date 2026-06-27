#!/usr/bin/env bash
#
# build/release.sh — ONE command to cut a Kennel release.
#
# It does, end to end:
#   1. Bump the version in package.json (patch | minor | major | explicit X.Y.Z).
#   2. Commit the bump, tag v<version>, and push branch + tag FIRST — so the git
#      tag already points at the released commit before any GitHub release is made
#      (promoting a release otherwise auto-creates the tag at the wrong commit).
#   3. Build + package the universal dmg/zip, generate update metadata
#      (latest-mac.yml), and upload everything to a DRAFT GitHub release for the tag.
#   4. Sign + notarize + staple the dmg container, then replace the placeholder
#      dmg on the release with the signed one.  (steps 3-4 = `npm run release:dist`)
#   5. Promote the GitHub release out of draft and mark it `latest` so the
#      auto-updater and the website's /releases/latest/download/ links resolve.
#      (The tag already exists, so this never creates a conflicting tag.)
#   6. Rewrite the download links on the Vercel website to the new version and
#      redeploy it (commit + push + `vercel --prod`).
#
# Usage:
#   bash build/release.sh                 # patch bump (0.1.0 -> 0.1.1)
#   bash build/release.sh minor           # 0.1.0 -> 0.2.0
#   bash build/release.sh 1.4.2           # explicit version
#   npm run release -- minor              # same, via npm
#
# Run it from a clean, up-to-date DEFAULT branch (main) — release commits land
# there directly. Merge feature PRs first, then release from main.
#
# Required environment:
#   GH_TOKEN                      GitHub token w/ repo scope (electron-builder + gh)
#   APPLE_ID                      Apple ID for notarization
#   APPLE_APP_SPECIFIC_PASSWORD  appleid.apple.com -> App-Specific Passwords
#   APPLE_TEAM_ID                Apple Team ID
#
# Optional environment:
#   KENNEL_WEBSITE_DIR     Path to the website repo (default: ../kennel-website)
#   RELEASE_KEEP_DRAFT=1   Build + upload to a DRAFT only (local commit/tag, not
#                          pushed; no promote, no website). For manual review.
#   RELEASE_SKIP_WEBSITE=1 Do the full app release but don't touch the website.
#   RELEASE_ALLOW_BRANCH=1 Skip the "must be on an up-to-date default branch" guard.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUMP="${1:-patch}"
WEBSITE_DIR="${KENNEL_WEBSITE_DIR:-$ROOT/../kennel-website}"

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── Preconditions ──────────────────────────────────────────────────────────
command -v gh   >/dev/null || die "gh CLI not found (brew install gh)."
command -v node >/dev/null || die "node not found."
: "${GH_TOKEN:?Set GH_TOKEN (GitHub token with repo scope)}"
: "${APPLE_ID:?Set APPLE_ID}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?Set APPLE_APP_SPECIFIC_PASSWORD}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID}"

# The release must start from a clean tree so the published artifacts correspond
# to a known commit. (The version bump below is the only change we introduce.)
[[ -z "$(git status --porcelain)" ]] || die "Working tree is dirty. Commit or stash changes before releasing."

# Release from a clean, up-to-date default branch. Releasing from a stale/merged
# feature branch strands the bump commit and lets GitHub tag the wrong commit.
if [[ "${RELEASE_ALLOW_BRANCH:-}" != "1" ]]; then
  DEFAULT="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  DEFAULT="${DEFAULT:-main}"
  CURRENT="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$CURRENT" == "$DEFAULT" ]] || die "On '$CURRENT', not the default branch '$DEFAULT'. Merge your PR, switch to $DEFAULT, then release (or set RELEASE_ALLOW_BRANCH=1)."
  git fetch --quiet origin "$DEFAULT"
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$DEFAULT")" ]] \
    || die "Local '$DEFAULT' is not in sync with origin/$DEFAULT. Pull/push first (or set RELEASE_ALLOW_BRANCH=1)."
fi

OLD="$(node -p "require('./package.json').version")"

# ── 1. Bump version ─────────────────────────────────────────────────────────
say "Bumping version ($BUMP) from v$OLD"
npm version "$BUMP" --no-git-tag-version >/dev/null
NEW="$(node -p "require('./package.json').version")"
TAG="v$NEW"
[[ "$NEW" != "$OLD" ]] || die "Version did not change."

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "Tag $TAG already exists locally."
! git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1 || die "Tag $TAG already exists on origin."
say "Releasing $TAG"

# ── 2. Commit the bump + tag, and (for a full release) push them FIRST ───────
say "Committing version bump and tagging $TAG"
git commit -aqm "release: $TAG"
git tag "$TAG"
if [[ "${RELEASE_KEEP_DRAFT:-}" != "1" ]]; then
  git push --quiet
  git push --quiet origin "$TAG"
fi

# ── 3-4. Build, publish to draft, sign the dmg, upload signed dmg ────────────
say "Building + publishing update artifacts to draft release $TAG"
npm run release:dist

# ── 5. Promote out of draft (tag already exists → no tag conflict) ───────────
if [[ "${RELEASE_KEEP_DRAFT:-}" == "1" ]]; then
  say "RELEASE_KEEP_DRAFT=1 — draft $TAG built (commit + tag are LOCAL only)."
  say "To finish: gh release edit $TAG --draft=false --latest && git push && git push origin $TAG"
  exit 0
fi

say "Publishing GitHub release $TAG (out of draft, marked latest)"
gh release edit "$TAG" --draft=false --latest

# ── 6. Update + redeploy the website ────────────────────────────────────────
if [[ "${RELEASE_SKIP_WEBSITE:-}" == "1" ]]; then
  say "RELEASE_SKIP_WEBSITE=1 — skipping website update."
elif [[ -d "$WEBSITE_DIR" ]]; then
  say "Updating download links on the website to $NEW"
  # Rewrite the version embedded in every Kennel-<x.y.z>-universal.dmg link.
  find "$WEBSITE_DIR" -maxdepth 2 -name '*.html' -print0 \
    | xargs -0 perl -pi -e "s/Kennel-\d+\.\d+\.\d+-universal/Kennel-$NEW-universal/g"
  if [[ -n "$(git -C "$WEBSITE_DIR" status --porcelain)" ]]; then
    git -C "$WEBSITE_DIR" commit -aqm "chore: point downloads at $TAG"
    git -C "$WEBSITE_DIR" push --quiet
  else
    say "Website links already at $NEW — nothing to commit."
  fi
  say "Deploying website to Vercel (production)"
  ( cd "$WEBSITE_DIR" && npx --yes vercel --prod --yes )
else
  say "Website repo not found at $WEBSITE_DIR — skipping (set KENNEL_WEBSITE_DIR)."
fi

say "Done — released $TAG 🎉"
