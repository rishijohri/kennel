import { app } from 'electron'
import { autoUpdater, type UpdateInfo as EuUpdateInfo } from 'electron-updater'
import type { UpdateInfo, UpdateState } from '@shared/types'
import { sendUpdateEvent } from './broadcast'

// ── GitHub auto-update (electron-updater) ───────────────────────────────────
//
// Only runs in the packaged, Developer-ID-signed app: Squirrel.Mac validates the
// downloaded .zip's signature against the running app, so dev/unsigned builds are
// a hard no-op (state stays { phase:'idle', supported:false }). The update feed is
// the project's GitHub Releases — electron-builder embeds `app-update.yml`
// (owner/repo) at build time from the `publish:` block in electron-builder.yml.
//
// Flow: initUpdater() checks on startup → 'update-available' → the renderer pops
// the dialog. downloadUpdate(restartWhenReady) streams progress; on
// 'update-downloaded' we either quitAndInstall immediately (restartWhenReady) or
// surface the top-right "Restart to update" pill for the user to trigger.

let state: UpdateState = { phase: 'idle', supported: false }
let wired = false
let recheckTimer: ReturnType<typeof setInterval> | null = null

function set(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
  sendUpdateEvent(state)
}

function toInfo(i: EuUpdateInfo): UpdateInfo {
  return {
    version: i.version,
    releaseName: typeof i.releaseName === 'string' ? i.releaseName : undefined,
    releaseNotes: typeof i.releaseNotes === 'string' ? i.releaseNotes : undefined,
    releaseDate: i.releaseDate
  }
}

export function getUpdateState(): UpdateState {
  return state
}

/** Bind the autoUpdater event handlers exactly once. */
function wire(): void {
  if (wired) return
  wired = true
  // The popup / user decides when to download; a deferred (downloaded) update
  // still installs on the next normal quit.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    // A re-check must never clobber an in-progress download or a staged update.
    if (state.phase === 'downloading' || state.phase === 'downloaded') return
    set({ phase: 'checking', error: undefined })
  })
  autoUpdater.on('update-available', (info) =>
    set({ phase: 'available', info: toInfo(info), percent: 0, error: undefined })
  )
  autoUpdater.on('update-not-available', () => set({ phase: 'idle', info: undefined }))
  autoUpdater.on('download-progress', (p) =>
    set({
      phase: 'downloading',
      percent: Math.min(100, Math.round(p.percent)),
      bytesPerSecond: Math.round(p.bytesPerSecond)
    })
  )
  autoUpdater.on('update-downloaded', (info) => {
    set({ phase: 'downloaded', info: toInfo(info), percent: 100 })
    // Let the renderer paint the 'downloaded' state before the app quits.
    if (state.restartWhenReady) setTimeout(() => autoUpdater.quitAndInstall(), 600)
  })
  autoUpdater.on('error', (err) => set({ phase: 'error', error: err?.message ?? String(err) }))
}

/** Called once at startup. Marks unsupported and no-ops in dev / unsigned builds. */
export function initUpdater(): void {
  if (!app.isPackaged) {
    state = { phase: 'idle', supported: false }
    return
  }
  state = { phase: 'idle', supported: true }
  wire()
  void checkForUpdates()
  // Re-check while the app stays open (every 6 hours), but never while an update
  // is already available/downloading/staged — that would clobber the pill/progress.
  recheckTimer = setInterval(() => {
    if (state.phase === 'idle' || state.phase === 'error') void checkForUpdates()
  }, 6 * 60 * 60 * 1000)
}

/** Stop the periodic re-check (called on app quit). */
export function stopUpdater(): void {
  if (recheckTimer) {
    clearInterval(recheckTimer)
    recheckTimer = null
  }
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return state
  // Don't disturb an in-progress download or an already-staged (downloaded) update.
  if (state.phase === 'downloading' || state.phase === 'downloaded') return state
  wire()
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ phase: 'error', error: e instanceof Error ? e.message : 'Update check failed' })
  }
  return state
}

export async function downloadUpdate(restartWhenReady: boolean): Promise<void> {
  if (!app.isPackaged) return
  wire()
  set({ restartWhenReady, phase: 'downloading', percent: state.percent ?? 0, error: undefined })
  try {
    await autoUpdater.downloadUpdate()
  } catch (e) {
    set({ phase: 'error', error: e instanceof Error ? e.message : 'Download failed' })
  }
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return
  // isSilent=false (show the installer on win), isForceRunAfter=true (relaunch).
  autoUpdater.quitAndInstall(false, true)
}
