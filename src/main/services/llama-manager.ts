import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { app } from 'electron'
import type { LlamaEngineState, LlamaInstall, LlamaRelease } from '@shared/types'
import { store } from './store'
import { sendDownloadProgress } from './broadcast'
import { streamDownload } from './net-download'

const execFileP = promisify(execFile)

const RELEASES_URL = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30'
const UA = 'kennel-app'
/** Marker written into each install dir recording the resolved binary. */
const MARKER = '.kennel-install.json'

function buildsDir(): string {
  const d = join(app.getPath('userData'), 'llama-builds')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

// ── Platform → release-asset matching ────────────────────────────────────────

interface PlatformSpec {
  /** Label we download for, e.g. "macos-arm64". */
  label: string
  /** True if an asset filename targets this platform+arch. */
  match: (name: string) => boolean
}

// Asset naming (ggml-org/llama.cpp): macOS/Linux ship `.tar.gz`, Windows `.zip`.
//   llama-bNNNN-bin-macos-arm64.tar.gz   llama-bNNNN-bin-ubuntu-x64.tar.gz
//   llama-bNNNN-bin-win-cpu-x64.zip      (cuda/hip/sycl/vulkan variants also exist)
// We pick the plain CPU build for each platform — broadly compatible, no extra
// runtimes. The "ubuntu-x64" / "macos-arm64" substrings are contiguous only in
// the plain builds (variants insert e.g. "-vulkan-"), so substring match is safe.
function platformSpec(): PlatformSpec | null {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') {
    return { label: `macos-${arch}`, match: (n) => n.includes(`macos-${arch}`) && n.endsWith('.tar.gz') }
  }
  if (process.platform === 'linux') {
    return { label: `ubuntu-${arch}`, match: (n) => n.includes(`ubuntu-${arch}`) && n.endsWith('.tar.gz') }
  }
  if (process.platform === 'win32') {
    return {
      label: `win-${arch}`,
      match: (n) => n.startsWith('llama-') && n.includes(`win-cpu-${arch}`) && n.endsWith('.zip')
    }
  }
  return null
}

export function platformLabel(): string | null {
  return platformSpec()?.label ?? null
}

function pickAsset(
  spec: PlatformSpec,
  assets: { name: string; browser_download_url: string; size: number }[]
): { name: string; url: string; size: number } | null {
  const a = assets.find((x) => spec.match(x.name))
  return a ? { name: a.name, url: a.browser_download_url, size: a.size } : null
}

// ── Releases ─────────────────────────────────────────────────────────────────

interface GhRelease {
  tag_name: string
  name: string | null
  published_at: string
  body: string | null
  html_url: string
  prerelease: boolean
  assets: { name: string; browser_download_url: string; size: number }[]
}

export async function listReleases(): Promise<LlamaRelease[]> {
  const spec = platformSpec()
  const res = await fetch(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA }
  })
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} ${res.statusText} fetching llama.cpp releases.`)
  }
  const raw = (await res.json()) as GhRelease[]
  return raw.map((r) => ({
    tag: r.tag_name,
    name: r.name?.trim() || r.tag_name,
    publishedAt: r.published_at,
    notes: (r.body ?? '').trim().slice(0, 8000),
    htmlUrl: r.html_url,
    prerelease: r.prerelease,
    asset: spec ? pickAsset(spec, r.assets ?? []) : null
  }))
}

// ── Installed builds ─────────────────────────────────────────────────────────

function readMarker(dir: string): LlamaInstall | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as LlamaInstall
    if (m.binaryPath && existsSync(m.binaryPath)) return m
  } catch {
    /* not a valid install */
  }
  return null
}

function listInstalls(): LlamaInstall[] {
  const root = buildsDir()
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => readMarker(join(root, e.name)))
    .filter((m): m is LlamaInstall => m !== null)
    .sort((a, b) => b.installedAt - a.installedAt)
}

export function engineState(): LlamaEngineState {
  const installs = listInstalls()
  const stored = store.getLlamaActiveTag()
  let activeTag = stored
  // Self-heal: if the active build is gone, adopt the newest install (or clear).
  if (activeTag && !installs.some((i) => i.tag === activeTag)) activeTag = null
  if (!activeTag && installs.length) activeTag = installs[0].tag
  // Persist only when the healed value actually diverged from disk — covers both
  // adopt-newest and clear-to-null, and writes at most once (idempotent).
  if (activeTag !== stored) store.setLlamaActiveTag(activeTag)
  return { platform: platformLabel() ?? 'unsupported', installs, activeTag }
}

/** Path to the active engine's llama-server, or null if none is installed. */
export function activeBinary(): string | null {
  const { installs, activeTag } = engineState()
  const active = installs.find((i) => i.tag === activeTag) ?? installs[0]
  return active?.binaryPath ?? null
}

export function setActive(tag: string): LlamaEngineState {
  if (!listInstalls().some((i) => i.tag === tag)) throw new Error('That engine build is not installed.')
  store.setLlamaActiveTag(tag)
  return engineState()
}

export function removeBuild(tag: string): LlamaEngineState {
  const dir = join(buildsDir(), tag)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  if (store.getLlamaActiveTag() === tag) store.setLlamaActiveTag(null)
  return engineState()
}

// ── Download + install ───────────────────────────────────────────────────────

/** Recursively find the llama-server executable inside an extracted build. */
function findBinary(dir: string): string | null {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.name === exe) return full
    }
  }
  return null
}

function findFiles(dir: string, pred: (name: string) => boolean): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (pred(e.name)) out.push(full)
    }
  }
  return out
}

/** Extract by archive type: `.tar.gz` (macOS/Linux) via tar, `.zip` (Windows). */
async function extractArchive(archive: string, dest: string): Promise<void> {
  mkdirSync(dest, { recursive: true })
  const lower = archive.toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await execFileP('tar', ['-xzf', archive, '-C', dest])
  } else if (process.platform === 'win32') {
    await execFileP('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dest}' -Force`
    ])
  } else if (process.platform === 'darwin') {
    await execFileP('ditto', ['-x', '-k', archive, dest])
  } else {
    await execFileP('unzip', ['-o', archive, '-d', dest])
  }
}

/**
 * macOS: make a freshly-downloaded build runnable on a notarized install —
 * strip quarantine (defensive; programmatic downloads aren't quarantined) and
 * ad-hoc codesign every Mach-O so arm64 code is accepted by the kernel. Needs no
 * Developer ID; `codesign`/`xattr` ship with macOS.
 */
async function macHarden(rootDir: string, binaryPath: string): Promise<void> {
  try {
    await execFileP('xattr', ['-dr', 'com.apple.quarantine', rootDir])
  } catch {
    /* nothing to strip */
  }
  // Dylibs are best-effort (most arrive already signed); a failure here is rare
  // and the loader is forgiving once the executable itself is valid.
  const dylibs = findFiles(rootDir, (n) => n.endsWith('.dylib'))
  for (const f of dylibs) {
    try {
      await execFileP('codesign', ['--force', '--sign', '-', f])
    } catch {
      /* best-effort */
    }
  }
  // The executable MUST be signed — unsigned arm64 code is killed by the kernel.
  // Let a failure propagate so downloadRelease discards the unrunnable build.
  try {
    await execFileP('codesign', ['--force', '--sign', '-', binaryPath])
  } catch (err: any) {
    throw new Error(`Failed to code-sign the downloaded engine: ${err?.message ?? String(err)}`)
  }
}

let inFlight: string | null = null

export async function downloadRelease(tag: string): Promise<LlamaEngineState> {
  if (inFlight) throw new Error(`Already downloading ${inFlight}. Wait for it to finish.`)
  const spec = platformSpec()
  if (!spec) throw new Error('No llama.cpp build is available for this platform.')

  const releases = await listReleases()
  const rel = releases.find((r) => r.tag === tag)
  if (!rel) throw new Error(`Release ${tag} not found.`)
  if (!rel.asset) throw new Error(`Release ${tag} has no build for ${spec.label}.`)

  inFlight = tag
  const id = tag
  const label = `llama ${tag} (${spec.label})`
  const emit = (phase: 'downloading' | 'extracting' | 'installing' | 'done' | 'error', recv: number, total: number, message?: string) =>
    sendDownloadProgress({ id, kind: 'llama', label, receivedBytes: recv, totalBytes: total, phase, message })

  const ext = rel.asset.name.toLowerCase().endsWith('.zip') ? '.zip' : '.tar.gz'
  const tmpArchive = join(tmpdir(), `kennel-llama-${tag}-${Date.now()}${ext}`)
  const dest = join(buildsDir(), tag)
  try {
    // Fresh install dir.
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })

    emit('downloading', 0, rel.asset.size)
    let last = 0
    await streamDownload(rel.asset.url, tmpArchive, { 'User-Agent': UA }, (recv, total) => {
      const now = Date.now()
      if (now - last > 200 || recv === total) {
        last = now
        emit('downloading', recv, total || rel.asset!.size)
      }
    })

    emit('extracting', rel.asset.size, rel.asset.size)
    await extractArchive(tmpArchive, dest)

    const binary = findBinary(dest)
    if (!binary) throw new Error('Downloaded build did not contain a llama-server executable.')

    emit('installing', rel.asset.size, rel.asset.size)
    try {
      chmodSync(binary, 0o755)
    } catch {
      /* ignore */
    }
    if (process.platform === 'darwin') await macHarden(dest, binary)

    const install: LlamaInstall = {
      tag,
      platform: spec.label,
      binaryPath: binary,
      installedAt: Date.now()
    }
    writeFileSync(join(dest, MARKER), JSON.stringify(install, null, 2))
    store.setLlamaActiveTag(tag) // newly downloaded build becomes active

    emit('done', rel.asset.size, rel.asset.size)
    return engineState()
  } catch (err: any) {
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    emit('error', 0, 0, err?.message ?? String(err))
    throw err
  } finally {
    try {
      if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true })
    } catch {
      /* ignore */
    }
    inFlight = null
  }
}
