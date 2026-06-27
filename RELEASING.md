# Releasing Kennel

Kennel ships a built-in auto-updater (`electron-updater`) that pulls new versions from
this repo's **GitHub Releases**. For an update to be discoverable, a release must contain
the metadata electron-builder generates — most importantly **`latest-mac.yml`** plus the
universal **`.zip`** (the macOS updater installs from the zip, not the dmg).

> Auto-update only runs in the **packaged, Developer-ID-signed** app. It is a no-op in `npm run dev`
> and in unsigned builds. Existing installs only gain the updater once a user installs a build that
> contains it — the first upgrade after this change is still a manual download.

## One command

```bash
# Provide signing + publishing credentials once per shell:
export GH_TOKEN=<GitHub token with repo scope>           # electron-builder --publish + gh
export APPLE_ID=<your Apple ID>
export APPLE_APP_SPECIFIC_PASSWORD=<app-specific password>  # appleid.apple.com → App-Specific Passwords
export APPLE_TEAM_ID=<your Apple Team ID>

npm run release                # patch bump: 0.1.0 → 0.1.1
npm run release -- minor       # 0.1.0 → 0.2.0
npm run release -- major       # 0.1.0 → 1.0.0
npm run release -- 1.4.2       # explicit version
```

That single command ([`build/release.sh`](build/release.sh)) does everything, in order:

1. **Bumps the version** in `package.json` (the only source of truth — `app.getVersion()`
   and the MCP client id read from it at runtime).
2. **Builds + publishes** the universal **dmg + zip**, generates **`latest-mac.yml`** +
   blockmaps, and uploads them to a **draft** GitHub release tagged `v<version>`. The `.app`
   inside both archives is signed + notarized here (`notarize: true`). *(= `npm run release:dist`.)*
3. **Signs + notarizes + staples the dmg container** (electron-builder leaves it unsigned) and
   replaces the placeholder dmg on the release with the signed one.
4. **Promotes the release** out of draft and marks it `latest`, so the auto-updater and the
   website's `/releases/latest/download/` links resolve.
5. **Updates the website** — rewrites the `Kennel-<version>-universal.dmg` download links in
   [`../kennel-website`](../kennel-website), commits + pushes, and redeploys to Vercel
   (`vercel --prod`).
6. **Commits the version bump, tags `v<version>`, and pushes** the app repo.

### Knobs

| Env var | Effect |
| --- | --- |
| `RELEASE_KEEP_DRAFT=1` | Stop after step 3 (leave the GitHub release a draft for manual review). Skips promote, website, and push. |
| `RELEASE_SKIP_WEBSITE=1` | Do the full app release but don't touch the website. |
| `KENNEL_WEBSITE_DIR=<path>` | Point at the website repo if it isn't `../kennel-website`. |

> **Review gate.** electron-updater ignores draft/pre-release releases, so step 4 is what makes
> an update live. If you want to eyeball the assets first, run with `RELEASE_KEEP_DRAFT=1`, inspect
> the draft on GitHub, then finish with `gh release edit v<version> --draft=false --latest` (and
> re-run the website + push steps yourself, or just `npm run release` from the now-clean tree).

### Recovery

The signed dmg lives in `release/` after a run. If the dmg upload fails (e.g. a flaky network),
re-run just that step — nothing else needs rebuilding:

```bash
gh release upload "v<version>" release/*.dmg --clobber
```

`npm run dist:mac` still produces a local signed dmg without publishing anything, for ad-hoc builds.
