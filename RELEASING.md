# Releasing Kennel (with auto-update)

Kennel ships a built-in auto-updater (`electron-updater`) that pulls new versions from
this repo's **GitHub Releases**. For an update to be discoverable, a release must contain
the update metadata electron-builder generates — most importantly **`latest-mac.yml`** plus
the universal **`.zip`** (the macOS updater installs from the zip, not the dmg).

> Auto-update only runs in the **packaged, Developer-ID-signed** app. It is a no-op in `npm run dev`
> and in unsigned builds. Existing installs only gain the updater once a user installs a build that
> contains it — the first upgrade after this change is still a manual download.

## One-command release

```bash
# 1. Bump the version FIRST (electron-updater compares semver).
#    Edit package.json "version", e.g. 0.1.0 -> 0.1.1

# 2. Provide the signing + publishing credentials in the environment:
export GH_TOKEN=<a GitHub token with repo scope>          # used by electron-builder --publish
export APPLE_ID=<your Apple ID>
export APPLE_APP_SPECIFIC_PASSWORD=<app-specific password> # appleid.apple.com → App-Specific Passwords
export APPLE_TEAM_ID=<your Apple Team ID>

# 3. Build, publish the update artifacts, sign the dmg, and upload the signed dmg:
npm run release
```

`npm run release` runs:

1. `electron-vite build` — compile main/preload/renderer.
2. `electron-builder --publish always` — package the universal **dmg + zip**, generate
   **`latest-mac.yml`** + blockmaps, and upload them (plus a placeholder dmg) to a **draft**
   GitHub release tagged `v<version>`. The `.app` inside both the dmg and zip is signed +
   notarized here (`notarize: true`).
3. `build/sign-dmg.sh` — sign, notarize, and staple the **dmg container** (electron-builder
   leaves it unsigned), so the dmg opens cleanly on any Mac.
4. `gh release upload "v<version>" release/*.dmg --clobber` — replace the placeholder dmg on
   the draft with the signed/stapled one.

## Then: review and PUBLISH the draft  ⚠️ required

electron-updater **ignores draft and pre-release** releases. The release stays private until you
publish it, which is the intended review gate:

1. Open the new **draft** release on GitHub.
2. Confirm the assets are all present:
   - `Kennel-<version>-universal-mac.zip` and `…-mac.zip.blockmap`  ← the updater downloads these
   - `latest-mac.yml`                                               ← the update feed
   - `Kennel-<version>-universal.dmg` (signed/stapled) and its `.blockmap`  ← manual installs
3. Click **Publish release**. Clients now see the update on their next launch / 6-hour re-check.

### Recovery

The signed dmg lives in `release/` after a run. If step 4's upload fails (e.g. a flaky network
after `--clobber` removed the old asset), just re-run it — nothing else needs rebuilding:

```bash
gh release upload "v<version>" release/*.dmg --clobber
```

`npm run dist:mac` still produces a local signed dmg without publishing anything, for ad-hoc builds.
