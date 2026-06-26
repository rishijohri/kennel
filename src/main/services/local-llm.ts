import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import type { LocalDefaults, LocalServerConfig, LocalServerStatus } from '@shared/types'
import { store } from './store'
import { sendLocalStatus, sendState } from './broadcast'
import { activeBinary, platformLabel } from './llama-manager'

/** Fixed id so the auto-registered provider updates in place across restarts. */
const LOCAL_PROVIDER_ID = 'kennel-local-llm'
const DEFAULT_PORT = 8080
const HEALTH_TIMEOUT_MS = 120_000

let proc: ChildProcess | null = null
let current: LocalServerConfig | null = null
let starting = false
let lastError: string | null = null
let logBuf = ''

function appendLog(text: string): void {
  logBuf += text
  if (logBuf.length > 8000) logBuf = logBuf.slice(-8000)
}

export function getDefaults(): LocalDefaults {
  // The engine is downloaded at runtime (llama-manager); models are user-curated
  // (file browser or HuggingFace). We surface the active engine binary + the
  // platform label we download for, plus a suggested port.
  return {
    binaryPath: activeBinary(),
    binaryPlatform: platformLabel(),
    suggestedPort: DEFAULT_PORT
  }
}

export function getStatus(): LocalServerStatus {
  return {
    running: Boolean(proc) && !starting,
    starting,
    config: current,
    baseUrl: current ? `http://127.0.0.1:${current.port}/v1` : null,
    providerId: proc ? LOCAL_PROVIDER_ID : null,
    error: lastError,
    log: logBuf.slice(-4000)
  }
}

function emit(): void {
  sendLocalStatus(getStatus())
}

async function waitForHealth(port: number): Promise<boolean> {
  const start = Date.now()
  const url = `http://127.0.0.1:${port}/health`
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    if (!proc) return false // process died while waiting
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 600))
    emit() // stream log progress while the model loads
  }
  return false
}

export async function startServer(config: LocalServerConfig): Promise<LocalServerStatus> {
  await stopServer()

  const adv = config.advanced ?? {}
  // The active downloaded engine by default; an explicit override wins.
  const binaryPath = adv.binaryPath?.trim() || activeBinary()
  if (!binaryPath) {
    throw new Error(
      'No llama.cpp engine installed yet — download one from Local Models (or set an external binary in Advanced options).'
    )
  }
  if (!existsSync(binaryPath)) throw new Error('llama-server binary not found at that path.')
  if (!existsSync(config.modelPath)) throw new Error('Model file (.gguf) not found at that path.')

  current = config
  lastError = null
  logBuf = ''
  starting = true
  emit()

  const args = [
    '-m',
    config.modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(config.port),
    '-c',
    String(config.ctxSize),
    '-ngl',
    String(config.gpuLayers)
  ]
  if (config.jinja) args.push('--jinja')
  if (config.alias) args.push('--alias', config.alias)
  // Advanced options — only passed when the user enabled/set them.
  if (adv.threads && adv.threads > 0) args.push('-t', String(adv.threads))
  if (adv.batchSize && adv.batchSize > 0) args.push('-b', String(adv.batchSize))
  if (adv.ubatchSize && adv.ubatchSize > 0) args.push('-ub', String(adv.ubatchSize))
  if (adv.parallel && adv.parallel > 0) args.push('-np', String(adv.parallel))
  if (adv.flashAttention) args.push('--flash-attn', 'on')
  if (adv.mlock) args.push('--mlock')
  if (adv.noMmap) args.push('--no-mmap')

  const binDir = dirname(binaryPath)
  // Let the binary find its sibling dylibs (libmtmd, libllama, libggml…).
  const libPath = [binDir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')
  const fallback = [binDir, process.env.DYLD_FALLBACK_LIBRARY_PATH].filter(Boolean).join(':')

  proc = spawn(binaryPath, args, {
    cwd: binDir,
    env: {
      ...process.env,
      DYLD_LIBRARY_PATH: libPath,
      DYLD_FALLBACK_LIBRARY_PATH: fallback,
      LD_LIBRARY_PATH: [binDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
    }
  })

  proc.stdout?.on('data', (d) => appendLog(d.toString()))
  proc.stderr?.on('data', (d) => appendLog(d.toString()))
  proc.on('error', (e) => {
    lastError = e.message
    starting = false
    proc = null
    emit()
  })
  proc.on('exit', (code, signal) => {
    if (starting && !lastError) {
      lastError =
        `llama-server exited before it was ready (code ${code ?? signal}).\n` +
        logBuf.slice(-1200).trim()
    }
    starting = false
    proc = null
    emit()
  })

  const ok = await waitForHealth(config.port)
  if (!ok) {
    const err = lastError ?? 'Server did not become ready within the timeout.'
    await stopServer()
    lastError = err
    starting = false
    emit()
    throw new Error(err)
  }

  starting = false
  // Register / refresh the OpenAI-compatible provider pointing at the server.
  const alias = config.alias || basename(config.modelPath, extname(config.modelPath))
  store.upsertProvider({
    id: LOCAL_PROVIDER_ID,
    name: 'Local (llama.cpp)',
    kind: 'openai-compatible',
    baseUrl: `http://127.0.0.1:${config.port}/v1`,
    defaultModel: alias,
    // Expose the served alias as a selectable model (chip + dropdown option), so
    // the local provider matches the discovered-models UX of the others.
    models: [alias]
  })
  sendState(store.getState())
  emit()
  return getStatus()
}

export async function stopServer(): Promise<LocalServerStatus> {
  const p = proc
  if (p) {
    proc = null
    starting = false
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      p.once('exit', done)
      try {
        p.kill('SIGTERM')
      } catch {
        return resolve()
      }
      // Hard-kill if it doesn't exit promptly.
      setTimeout(() => {
        try {
          p.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolve()
      }, 2500)
    })
  }
  current = null
  emit()
  return getStatus()
}
