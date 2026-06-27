// ── GitHub Copilot setup/auth (for the @github/copilot-sdk run path) ────────
// The `copilot` provider has no API key. Personas on it run through the GitHub
// Copilot SDK (see agent/provider-copilot.ts), which bundles its own runtime —
// so "installed" means the bundled SDK is present in this build. The remaining
// requirement is being SIGNED IN: the SDK's useLoggedInUser reads the stored CLI
// login (~/.copilot/config.json), which this module detects and (re)establishes.

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { CopilotStatus, CopilotSetupEvent } from '@shared/types'

/** npm package that provides the `copilot` login CLI (also the SDK's runtime). */
const CLI_PKG = '@github/copilot'

/**
 * The model ids Copilot offers. Static (real) ids so the persona dropdown
 * populates without a live call — actual access still depends on the account's
 * Copilot entitlement. "auto" lets Copilot pick. Refreshable via the SDK's
 * client.listModels() once entitled.
 */
const KNOWN_COPILOT_MODELS = [
  'auto',
  'claude-sonnet-4.5',
  'claude-haiku-4.5',
  'claude-opus-4.6',
  'claude-sonnet-4',
  'gemini-3-pro-preview',
  'gpt-5.1-codex',
  'gpt-5.1',
  'gpt-5',
  'gpt-5-mini',
  'gpt-4.1'
]

const isWin = process.platform === 'win32'

/** Kennel-managed install dir (legacy fallback when the SDK isn't bundled). */
function managedDir(): string {
  return join(app.getPath('userData'), 'copilot')
}

/** The CLI's config directory — matches the runtime: COPILOT_HOME, else ~/.copilot.
 *  (The runtime does NOT use XDG_CONFIG_HOME for config.json; only for shell
 *  completions — consulting it broke sign-in detection when it was set.) */
function configDir(): string {
  return process.env.COPILOT_HOME || join(homedir(), '.copilot')
}

const resourcesPath = (): string | undefined => (process as { resourcesPath?: string }).resourcesPath

/** Roots to search for the bundled runtime (dev + packaged asar/unpacked). */
function moduleRoots(): string[] {
  const roots = [join(managedDir(), 'node_modules'), join(process.cwd(), 'node_modules')]
  const rp = resourcesPath()
  if (rp) roots.push(join(rp, 'app.asar.unpacked', 'node_modules'), join(rp, 'app', 'node_modules'))
  return roots
}

/** Candidate `copilot` login binaries: a real .bin first, else the runtime's
 *  npm-loader.js (a .js, run via this process's node — works in packaged builds
 *  where the .bin symlink isn't preserved). */
function binCandidates(): string[] {
  const name = isWin ? 'copilot.cmd' : 'copilot'
  const out: string[] = []
  for (const root of moduleRoots()) out.push(join(root, '.bin', name))
  for (const root of moduleRoots()) out.push(join(root, '@github', 'copilot', 'npm-loader.js'))
  return out
}

let cachedBin: string | null | undefined

/** Resolve the `copilot` binary (bundled with the SDK, or on PATH) — used for login. */
export async function resolveCopilotBin(): Promise<string | null> {
  if (cachedBin !== undefined) return cachedBin
  for (const c of binCandidates()) {
    if (existsSync(c)) {
      cachedBin = c
      return c
    }
  }
  cachedBin = await which('copilot')
  return cachedBin
}

/** Force the next resolveCopilotBin() to re-scan (after an install). */
export function invalidateCopilotBin(): void {
  cachedBin = undefined
}

/** Whether the bundled Copilot SDK is present in this build. */
function sdkInstalled(): boolean {
  const rel = join('node_modules', '@github', 'copilot-sdk', 'package.json')
  if (existsSync(join(process.cwd(), rel))) return true
  const rp = (process as { resourcesPath?: string }).resourcesPath
  if (rp && (existsSync(join(rp, 'app.asar', rel)) || existsSync(join(rp, 'app.asar.unpacked', rel)) || existsSync(join(rp, 'app', rel)))) {
    return true
  }
  try {
    require.resolve('@github/copilot-sdk')
    return true
  } catch {
    return false
  }
}

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(isWin ? 'where' : 'which', [cmd], { env: process.env })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      const first = out.split('\n').map((l) => l.trim()).find(Boolean)
      resolve(code === 0 && first ? first : null)
    })
  })
}

/**
 * A GitHub token to authenticate the Copilot SDK with — passed as `gitHubToken`
 * so the runtime does NOT read the stored credential from the macOS Keychain
 * (which prompts, and blocks the run, in unsigned/dev builds). Prefers an
 * explicit env token, then a `gh`-authenticated token. Returns undefined to fall
 * back to useLoggedInUser (the Keychain path) when neither is available.
 */
export async function resolveCopilotToken(): Promise<string | undefined> {
  const env = process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (env && env.trim()) return env.trim()
  const gh = await ghToken()
  return gh || undefined
}

/** Best-effort `gh auth token` (empty string if gh is absent / not authed). */
function ghToken(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(isWin ? 'gh.exe' : 'gh', ['auth', 'token'], { env: process.env })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('error', () => resolve(''))
    child.on('close', (code) => resolve(code === 0 ? out.trim() : ''))
  })
}

/** The signed-in GitHub login (and whether anyone is signed in at all). */
function readSignedIn(): { signedIn: boolean; login: string | null } {
  // An env token takes precedence over stored credentials (CLI's own rule).
  if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    return { signedIn: true, login: null }
  }
  try {
    const raw = readFileSync(join(configDir(), 'config.json'), 'utf8')
    // config.json is JSONC — strip whole-line // comments before parsing.
    const json = raw
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n')
    // The CLI changed config.json key style across versions (camelCase in 0.0.x,
    // snake_case in 1.x) — accept BOTH so detection is version-agnostic.
    const cfg = JSON.parse(json) as {
      lastLoggedInUser?: { login?: string }
      loggedInUsers?: { login?: string }[]
      last_logged_in_user?: { login?: string }
      logged_in_users?: { login?: string }[]
    }
    const login =
      cfg.lastLoggedInUser?.login ||
      cfg.loggedInUsers?.[0]?.login ||
      cfg.last_logged_in_user?.login ||
      cfg.logged_in_users?.[0]?.login ||
      null
    return { signedIn: Boolean(login), login }
  } catch {
    return { signedIn: false, login: null }
  }
}

/** Best-effort version string of the bundled runtime (cosmetic). */
function bundledVersion(): string | null {
  try {
    const pkg = require('@github/copilot/package.json') as { version?: string }
    return pkg.version ? `GitHub Copilot ${pkg.version}` : null
  } catch {
    return null
  }
}

export async function getCopilotStatus(): Promise<CopilotStatus> {
  const installed = sdkInstalled()
  const binPath = await resolveCopilotBin()
  const { signedIn, login } = readSignedIn()
  return {
    installed,
    binPath,
    version: installed ? bundledVersion() : null,
    signedIn,
    login,
    models: installed ? KNOWN_COPILOT_MODELS : []
  }
}

/**
 * Throw a clear, actionable error unless the SDK is present AND the user is
 * signed in, so a Copilot persona run fails fast with guidance.
 */
export async function assertCopilotReady(): Promise<void> {
  const status = await getCopilotStatus()
  if (!status.installed) {
    throw new Error('The GitHub Copilot SDK runtime is missing from this build.')
  }
  if (!status.signedIn) {
    throw new Error(
      'GitHub Copilot is not signed in. Open Settings → Providers → your Copilot provider and click “Sign in”.'
    )
  }
}

// ── In-app setup (login; install is a legacy fallback) ───────────────────────

let activeChild: ChildProcess | null = null

/** Abort an in-flight install or login. */
export function cancelCopilotSetup(): void {
  activeChild?.kill()
  activeChild = null
}

/** Stream a child's stdout+stderr line-ish chunks to onEvent for the given step. */
function streamChild(
  child: ChildProcess,
  kind: CopilotSetupEvent['kind'],
  onEvent: (e: CopilotSetupEvent) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const relay = (buf: Buffer) => {
      const line = buf.toString()
      if (line.trim()) onEvent({ kind, line })
    }
    child.stdout?.on('data', relay)
    child.stderr?.on('data', relay)
    child.on('error', (e) => reject(e))
    child.on('close', (code) => resolve(code ?? 0))
  })
}

/**
 * Legacy fallback: install the Copilot CLI into Kennel's managed dir via npm.
 * Normally unnecessary — the SDK runtime is bundled — but kept so a build that
 * somehow lacks it can recover. Streams npm output; resolves to refreshed status.
 */
export async function installCopilot(onEvent: (e: CopilotSetupEvent) => void): Promise<CopilotStatus> {
  const dir = managedDir()
  mkdirSync(dir, { recursive: true })
  onEvent({ kind: 'install', phase: 'running', line: `Installing ${CLI_PKG} into ${dir}…` })
  const npm = isWin ? 'npm.cmd' : 'npm'
  const child = spawn(npm, ['install', CLI_PKG, '--prefix', dir, '--no-fund', '--no-audit'], { cwd: dir, env: process.env })
  activeChild = child
  try {
    const code = await streamChild(child, 'install', onEvent)
    if (code !== 0) throw new Error(`npm install exited with code ${code}.`)
  } catch (e: any) {
    onEvent({ kind: 'install', phase: 'error', error: e?.message ?? String(e) })
    throw e
  } finally {
    if (activeChild === child) activeChild = null
  }
  invalidateCopilotBin()
  onEvent({ kind: 'install', phase: 'done' })
  return getCopilotStatus()
}

/**
 * Run `copilot login` (OAuth device flow). The CLI prints a one-time code + URL
 * we stream to the UI; the user completes sign-in in their browser and the CLI
 * exits 0 once authorized. Resolves to the refreshed status.
 */
export async function loginCopilot(onEvent: (e: CopilotSetupEvent) => void): Promise<CopilotStatus> {
  const bin = await resolveCopilotBin()
  if (!bin) {
    const err = 'Could not find the Copilot CLI to sign in with. Install GitHub Copilot CLI, or set GH_TOKEN.'
    onEvent({ kind: 'login', phase: 'error', error: err })
    throw new Error(err)
  }
  onEvent({ kind: 'login', phase: 'running', line: 'Starting GitHub sign-in…' })
  // A resolved npm-loader.js is run via this process's node (Electron as node);
  // a real binary is spawned directly. stdin is 'ignore' so the device flow
  // proceeds without us pressing keys — the user authorizes via the printed code.
  const isLoader = bin.endsWith('.js')
  const cmd = isLoader ? process.execPath : bin
  const args = isLoader ? [bin, 'login'] : ['login']
  const env = isLoader ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  activeChild = child
  try {
    const code = await streamChild(child, 'login', onEvent)
    if (code !== 0) throw new Error(`copilot login exited with code ${code}.`)
  } catch (e: any) {
    onEvent({ kind: 'login', phase: 'error', error: e?.message ?? String(e) })
    throw e
  } finally {
    if (activeChild === child) activeChild = null
  }
  onEvent({ kind: 'login', phase: 'done' })
  return getCopilotStatus()
}
