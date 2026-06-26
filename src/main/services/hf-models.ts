import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { HfModel, HfModelFile } from '@shared/types'
import { sendDownloadProgress } from './broadcast'
import { streamDownload } from './net-download'

// Recommended models come from the unsloth org. The user can still add ANY local
// GGUF via the file browser — these are recommendations only.
const ORG = 'unsloth'
const API = 'https://huggingface.co'

function modelsDir(): string {
  const d = join(app.getPath('userData'), 'models')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

interface HfApiModel {
  id: string
  downloads?: number
  likes?: number
  lastModified?: string
}

/** List unsloth GGUF model repos, most-downloaded first; optional search filter. */
export async function listModels(query?: string): Promise<HfModel[]> {
  const params = new URLSearchParams({
    author: ORG,
    filter: 'gguf',
    sort: 'downloads',
    direction: '-1',
    limit: '50'
  })
  if (query && query.trim()) params.set('search', query.trim())
  const res = await fetch(`${API}/api/models?${params.toString()}`, {
    headers: { Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`HuggingFace returned ${res.status} ${res.statusText}.`)
  const raw = (await res.json()) as HfApiModel[]
  return raw.map((m) => ({
    repo: m.id,
    name: m.id.includes('/') ? m.id.split('/').slice(1).join('/') : m.id,
    downloads: m.downloads ?? 0,
    likes: m.likes ?? 0,
    updatedAt: m.lastModified ?? ''
  }))
}

interface HfTreeEntry {
  type: 'file' | 'directory'
  path: string
  size?: number
}

/** List the GGUF files in a repo (with sizes), for the user to choose from. */
export async function listFiles(repo: string): Promise<HfModelFile[]> {
  const res = await fetch(`${API}/api/models/${repo}/tree/main?recursive=true`, {
    headers: { Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`HuggingFace returned ${res.status} ${res.statusText}.`)
  const raw = (await res.json()) as HfTreeEntry[]
  return raw
    .filter((e) => e.type === 'file' && e.path.toLowerCase().endsWith('.gguf'))
    .map((e) => ({
      repo,
      filename: e.path,
      size: typeof e.size === 'number' ? e.size : null,
      url: `${API}/${repo}/resolve/main/${e.path.split('/').map(encodeURIComponent).join('/')}`
    }))
    .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))
}

let inFlight: string | null = null

/** Download a GGUF into the local models dir; returns its absolute path. */
export async function downloadModel(file: HfModelFile): Promise<string> {
  const key = `${file.repo}/${file.filename}`
  if (inFlight) throw new Error(`Already downloading ${inFlight}. Wait for it to finish.`)
  inFlight = key

  // Flatten the repo + filename into a unique local name so two repos' identically
  // named quants don't collide.
  const safe = `${file.repo}--${file.filename}`.replace(/[^A-Za-z0-9._-]+/g, '_')
  const dest = join(modelsDir(), safe)
  // Stream to a .part file and rename on success, so a crash mid-download never
  // leaves a truncated file at the canonical model path.
  const part = `${dest}.part`
  const label = `${file.repo.split('/').pop()} · ${file.filename.split('/').pop()}`
  const emit = (phase: 'downloading' | 'done' | 'error', recv: number, total: number, message?: string) =>
    sendDownloadProgress({ id: key, kind: 'model', label, receivedBytes: recv, totalBytes: total, phase, message })

  try {
    emit('downloading', 0, file.size ?? 0)
    let last = 0
    await streamDownload(file.url, part, { Accept: 'application/octet-stream' }, (recv, total) => {
      const now = Date.now()
      if (now - last > 200 || (total && recv === total)) {
        last = now
        emit('downloading', recv, total || file.size || 0)
      }
    })
    renameSync(part, dest)
    emit('done', file.size ?? 0, file.size ?? 0)
    return dest
  } catch (err: any) {
    try {
      if (existsSync(part)) rmSync(part, { force: true })
    } catch {
      /* ignore */
    }
    emit('error', 0, 0, err?.message ?? String(err))
    throw err
  } finally {
    inFlight = null
  }
}
