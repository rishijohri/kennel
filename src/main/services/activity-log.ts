import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RunEvent } from '@shared/types'

// ── Persistent per-node activity log ────────────────────────────────────────
//
// A node's "Activity Log" (the streamed agent thinking / tool calls / command
// output) used to live only in the renderer's in-memory store, so it vanished on
// restart. Here we tee every RunEvent to disk, keyed by (globally-unique) node id,
// so the Log view and the Walker can read an OLD node's full activity after a
// relaunch. The node SUMMARY is persisted separately (with the node) and is what
// callers should prefer; this full log is the fallback when the summary isn't
// enough.

const dir = () => join(app.getPath('userData'), 'activity')
const fileFor = (nodeId: string) => join(dir(), `${encodeURIComponent(nodeId)}.json`)

/** Per-node event buffer for the active run (text events coalesced to stay small). */
const buffers = new Map<string, RunEvent[]>()
const dirty = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function ensureDir(): void {
  const d = dir()
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
}

/** Coalesce consecutive same-kind text events, mirroring the renderer's fold so
 *  the persisted stream stays compact (a long run is thousands of tokens). */
function appendCoalesced(arr: RunEvent[], e: RunEvent): void {
  const last = arr[arr.length - 1]
  if (e.type === 'thinking' && last?.type === 'thinking') last.text += e.text
  else if (e.type === 'assistant' && last?.type === 'assistant') last.text += e.text
  else if (e.type === 'output' && last?.type === 'output' && last.stream === e.stream)
    last.text += e.text
  else arr.push(e)
}

function flushNode(nodeId: string): void {
  const events = buffers.get(nodeId)
  if (!events) return
  try {
    ensureDir()
    writeFileSync(fileFor(nodeId), JSON.stringify(events))
    dirty.delete(nodeId)
  } catch {
    /* disk error — the live in-memory log still works this session */
  }
}

function scheduleFlush(nodeId: string): void {
  dirty.add(nodeId)
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    for (const id of [...dirty]) flushNode(id)
  }, 400)
}

/** Tee one run event into the node's persisted activity. 'start' resets the log
 *  (a node's log reflects its latest run); terminal events flush immediately. */
export function recordRunEvent(e: RunEvent): void {
  if (e.type === 'start') {
    buffers.set(e.nodeId, [e])
  } else {
    const arr = buffers.get(e.nodeId)
    if (arr) appendCoalesced(arr, e)
    else buffers.set(e.nodeId, [e]) // mid-run with no buffered start — seed defensively
  }

  if (e.type === 'done' || e.type === 'error') {
    flushNode(e.nodeId)
    buffers.delete(e.nodeId) // keep memory bounded; future reads come from disk
  } else {
    scheduleFlush(e.nodeId)
  }
}

/** The node's persisted activity (latest run), or [] if none. */
export function getNodeActivity(nodeId: string): RunEvent[] {
  const live = buffers.get(nodeId)
  if (live) return live.slice()
  try {
    const f = fileFor(nodeId)
    if (!existsSync(f)) return []
    return JSON.parse(readFileSync(f, 'utf8')) as RunEvent[]
  } catch {
    return []
  }
}

/** Drop a node's persisted activity (called when the node is deleted). */
export function deleteNodeActivity(nodeId: string): void {
  buffers.delete(nodeId)
  dirty.delete(nodeId)
  try {
    rmSync(fileFor(nodeId), { force: true })
  } catch {
    /* best-effort */
  }
}
