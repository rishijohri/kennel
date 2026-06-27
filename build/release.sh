#!/usr/bin/env bash
#
# build/release.sh — ONE command to cut a Kennel release.
#
# It does, end to end:
#   1. Bump the version in package.json (patch | minor | major | explicit X.Y.Z).
#   2. Build + package the universal dmg/zip, generate update metadata
#      (latest-mac.yml), and upload everything to a DRAFT GitHub release.
#   3. Sign + notarize + staple the dmg container, then replace the placeholder
#      dmg on the release with the signed one.
#   4. Promote the GitHub release out of draft and mark it `latest` so the
#      auto-updater and the website's /releases/latest/download/ links resolve.
#   5. Rewrite the download links on the Vercel website to the new version and
#      redeploy it (commit + push + `vercel --prod`).
#   6. Commit the version bump, tag `v<version>`, and push the app repo.
#
# Usage:
#   bash build/release.sh                 # patch bump (0.1.0 -> 0.1.1)
#   bash build/release.sh minor           # 0.1.0 -> 0.2.0
#   bash build/release.sh 1.4.2           # explicit version
#   npm run release -- minor              # same, via npm
#
# Required environment (same as the old flow):
#   GH_TOKEN                      GitHub token w/ repo scope (electron-builder + gh)
#   APPLE_ID                      Apple ID for notarization
#   APPLE_APP_SPECIFIC_PASSWORD  appleid.apple.com -> App-Specific Passwords
#   APPLE_TEAM_ID                Apple Team ID
#
# Optional environment:
#   KENNEL_WEBSITE_DIR   Path to the website repo (default: ../kennel-website)
#   RELEASE_KEEP_DRAFT=1 Stop at the draft (skip promote + website + push) for review
#   RELEASE_SKIP_WEBSITE=1  Do the app release but don't touch the website
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
if [[ -n "$(git status --porcelain)" ]]; then
  die "Working tree is dirty. Commit or stash changes before releasing."
fi

OLD="$(node -p "require('./package.json').version")"

# ── 1. Bump version ─────────────────────────────────────────────────────────
say "Bumping version ($BUMP) from v$OLD"
npm version "$BUMP" --no-git-tag-version >/dev/null
NEW="$(node -p "require('./package.json').version")"
TAG="v$NEW"
[[ "$NEW" != "$OLD" ]] || die "Version did not change."
say "Releasing $TAG"

# ── 2-3. Build, publish to draft, sign the dmg, upload signed dmg ───────────
say "Building + publishing update artifacts to draft release $TAG"
npm run release:dist

# ── 4. Promote the release out of draft ────────────────────────────────────
if [[ "${RELEASE_KEEP_DRAFT:-}" == "1" ]]; then
  say "RELEASE_KEEP_DRAFT=1 — leaving $TAG as a draft. Publish it manually."
else
  say "Publishing GitHub release $TAG (out of draft, marked latest)"
  gh release edit "$TAG" --draft=false --latest

  # ── 5. Update + redeploy the website ─────────────────────────────────────
  if [[ "${RELEASE_SKIP_WEBSITE:-}" == "1" ]]; then
    say "RELEASE_SKIP_WEBSITE=1 — skipping website update."
  elif [[ -d "$WEBSITE_DIR" ]]; then
    say "Updating download links on the website to $NEW"
    # Rewrite the version embedded in every Kennel-<x.y.z>-universal.dmg link.
    find "$WEBSITE_DIR" -maxdepth 2 -name '*.html' -print0 \
      | xargs -0 perl -pi -e "s/Kennel-\d+\.\d+\.\d+-universal/Kennel-$NEW-universal/g"
    if [[ -n "$(git -C "$WEBSITE_DIR" status --porcelain)" ]]; then
      git -C "$WEBSITE_DIR" commit -am "chore: point downloads at $TAG"
      git -C "$WEBSITE_DIR" push
    else
      say "Website links already at $NEW — nothing to commit."
    fi
    say "Deploying website to Vercel (production)"
    ( cd "$WEBSITE_DIR" && npx --yes vercel --prod --yes )
  else
    say "Website repo not found at $WEBSITE_DIR — skipping (set KENNEL_WEBSITE_DIR)."
  fi

  # ── 6. Commit the bump, tag, and push the app repo ──────────────────────
  say "Committing version bump and tagging $TAG"
  git commit -am "release: $TAG"
  git tag "$TAG"
  git push
  git push origin "$TAG"
fi

say "Done — released $TAG 🎉"
