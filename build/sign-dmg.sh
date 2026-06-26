#!/usr/bin/env bash
#
# build/sign-dmg.sh — sign, notarize, and staple a macOS .dmg so it opens
# cleanly (Gatekeeper-accepted) on ANY Mac, even offline.
#
# Why this exists: electron-builder's `notarize: true` notarizes + staples the
# .app INSIDE the dmg, but leaves the .dmg CONTAINER unsigned and unstapled, so a
# downloaded (quarantined) dmg can still be blocked. This finishes the job in the
# required order:  codesign  ->  notarytool  ->  staple.
#
# Usage:
#   APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... ./build/sign-dmg.sh [path/to.dmg]
#   ./build/sign-dmg.sh --verify [path/to.dmg]     # only re-check an already-signed dmg
#
#   • No path given -> the newest .dmg in release/ is used.
#   • Credentials come from the environment (same vars electron-builder uses).
#     APPLE_APP_SPECIFIC_PASSWORD = an app-specific password from
#     appleid.apple.com -> Sign-In & Security -> App-Specific Passwords.
#
# Requires: Xcode command line tools (codesign, xcrun notarytool, stapler) and a
# "Developer ID Application" certificate in your login keychain.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VERIFY_ONLY=false
DMG=""
for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY_ONLY=true ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *)  DMG="$arg" ;;
  esac
done

# Default to the newest dmg produced by `npm run dist`.
if [[ -z "$DMG" ]]; then
  DMG="$(ls -t "$ROOT"/release/*.dmg 2>/dev/null | head -1 || true)"
fi
if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  echo "❌ No .dmg found. Pass a path, or run 'npm run dist' first." >&2
  exit 1
fi
echo "📦 DMG: $DMG"

verify() {
  echo "── Verifying ────────────────────────────────────────────"
  echo "Gatekeeper (open):"
  spctl -a -t open --context context:primary-signature -vv "$DMG" 2>&1 | sed -n '1,3p'
  echo -n "Staple:            "
  xcrun stapler validate "$DMG" 2>&1 | tail -1
}

if [[ "$VERIFY_ONLY" == true ]]; then
  verify
  exit 0
fi

# Notarization credentials are required for the real run.
: "${APPLE_ID:?Set APPLE_ID}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?Set APPLE_APP_SPECIFIC_PASSWORD (appleid.apple.com -> App-Specific Passwords)}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID}"

# Pick the Developer ID Application identity from the keychain.
IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -o '"Developer ID Application:[^"]*"' | head -1 | tr -d '"')"
if [[ -z "$IDENTITY" ]]; then
  echo "❌ No 'Developer ID Application' certificate found in your keychain." >&2
  exit 1
fi
echo "🔑 Identity: $IDENTITY"

echo "── 1/3 codesign the dmg container ───────────────────────"
codesign --force --sign "$IDENTITY" --timestamp "$DMG"

echo "── 2/3 notarize (Apple round-trip — a few minutes) ──────"
# Capture so we can confirm the verdict even if notarytool's exit code surprises us.
SUBMIT_OUT="$(xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait 2>&1)" || true
echo "$SUBMIT_OUT" | grep -E "^[[:space:]]*(id|status):" | tail -3
if ! echo "$SUBMIT_OUT" | grep -q "status: Accepted"; then
  echo "❌ Notarization did not reach 'Accepted'. Full notarytool output:" >&2
  echo "$SUBMIT_OUT" >&2
  echo "   (Tip: 'xcrun notarytool log <submission-id> --apple-id ... --team-id ... --password ...' shows why.)" >&2
  exit 1
fi

echo "── 3/3 staple the ticket ────────────────────────────────"
xcrun stapler staple "$DMG"

echo ""
verify
echo ""
echo "✅ Done. Share this file: $DMG"
