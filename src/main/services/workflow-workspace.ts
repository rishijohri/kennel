import { app } from 'electron'
import { promises as fs, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { FileNodeTree } from '@shared/types'
import { addWorktree, removeWorktree } from './git'

/**
 * Per-run filesystem isolation for Park workflows.
 *
 * A run never touches the real project tree. Instead it gets:
 *  - `codebaseDir`: an ephemeral, detached git worktree of the Park's base commit
 *    — the codebase frozen at park-creation, READ-ONLY by policy, but real on disk
 *    so the workflow can run scripts/tests in it. Reset fresh every run, removed
 *    after, so no run ever sees another run's mutations to it.
 *  - `workspaceDir`: a writable directory where the workflow's OWN files live,
 *    shared by every node within a run. The codebase is mounted read-only inside
 *    it at `./codebase` (and via $KENNEL_CODEBASE) so commands can reach it.
 *
 * Recorded runs keep their workspace under userData/runs/<parkId>/<runId>;
 * temporary runs are discarded on completion.
 */
export interface RunWorkspace {
  runDir: string
  /** Ephemeral worktree @ baseCommit (read-only mount; removed after the run). */
  codebaseDir: string
  /** Writable outputs, shared across all nodes in the run. Agent cwd. */
  workspaceDir: string
}

function runsRoot(): string {
  return join(app.getPath('userData'), 'runs')
}

export function runDir(parkId: string, runId: string): string {
  return join(runsRoot(), parkId, runId)
}

/** The read-only codebase is exposed inside the workspace under this name. */
export const CODEBASE_MOUNT = 'codebase'

/** Create a fresh isolated workspace for a run. */
export async function createRunWorkspace(
  projectPath: string,
  baseCommit: string,
  parkId: string,
  runId: string
): Promise<RunWorkspace> {
  const dir = runDir(parkId, runId)
  const codebaseDir = join(dir, '.codebase')
  const workspaceDir = join(dir, 'workspace')
  // Start clean (an aborted prior attempt could have left a stale dir / worktree).
  await removeWorktree(projectPath, codebaseDir)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  await addWorktree(projectPath, codebaseDir, baseCommit)
  await fs.mkdir(workspaceDir, { recursive: true })
  // Mount the read-only codebase inside the workspace so `./codebase/...` works.
  await fs.symlink(codebaseDir, join(workspaceDir, CODEBASE_MOUNT), 'dir').catch(() => {})
  return { runDir: dir, codebaseDir, workspaceDir }
}

/** Remove the ephemeral codebase worktree + its in-workspace mount. Call after EVERY run. */
export async function teardownCodebase(projectPath: string, ws: RunWorkspace): Promise<void> {
  // Drop the convenience symlink first so the persisted workspace never dangles.
  await fs.rm(join(ws.workspaceDir, CODEBASE_MOUNT), { force: true }).catch(() => {})
  await removeWorktree(projectPath, ws.codebaseDir)
  await fs.rm(ws.codebaseDir, { recursive: true, force: true }).catch(() => {})
}

/** Delete an entire run directory (temporary runs, or pruning history). */
export async function discardRun(parkId: string, runId: string): Promise<void> {
  await fs.rm(runDir(parkId, runId), { recursive: true, force: true }).catch(() => {})
}

/** Delete every run directory belonging to a Park (on park delete). */
export async function discardParkRuns(parkId: string): Promise<void> {
  await fs.rm(join(runsRoot(), parkId), { recursive: true, force: true }).catch(() => {})
}

// ── Recorded-run workspace inspection ────────────────────────────────────────

const IGNORE = new Set(['.git', 'node_modules', '.codebase'])

/** Build a file tree of a recorded run's persisted workspace (null if absent). */
export async function workspaceTree(parkId: string, runId: string): Promise<FileNodeTree | null> {
  const root = join(runDir(parkId, runId), 'workspace')
  try {
    await fs.access(root)
  } catch {
    return null
  }
  async function walk(abs: string, rel: string, name: string): Promise<FileNodeTree> {
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      entries = []
    }
    const children: FileNodeTree[] = []
    for (const e of entries.sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
    )) {
      if (IGNORE.has(e.name) || e.isSymbolicLink()) continue
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) children.push(await walk(join(abs, e.name), childRel, e.name))
      else if (e.isFile()) children.push({ name: e.name, path: childRel, isDir: false })
    }
    return { name, path: rel, isDir: true, children }
  }
  return walk(root, '', 'workspace')
}

/** True if `abs` is `root` or strictly contained within it (cross-platform). */
function within(root: string, abs: string): boolean {
  const rel = relative(root, abs)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Read one file from a recorded run's persisted workspace (path-safe). */
export async function workspaceFile(
  parkId: string,
  runId: string,
  relPath: string
): Promise<string> {
  const root = join(runDir(parkId, runId), 'workspace')
  const abs = resolve(root, relPath)
  // Textual containment (handles .. and absolute inputs, cross-platform).
  if (!within(root, abs)) throw new Error('Path is outside the run workspace.')
  // Resolve symlinks and re-check, so a symlink inside the workspace can't escape it.
  let real: string
  try {
    real = realpathSync(abs)
  } catch {
    throw new Error('File not found in the run workspace.')
  }
  let realRoot = root
  try {
    realRoot = realpathSync(root)
  } catch {
    /* keep root */
  }
  if (!within(realRoot, real)) throw new Error('Path is outside the run workspace.')
  const buf = await fs.readFile(real)
  const text = buf.toString('utf8')
  const max = 200_000
  return text.length > max ? text.slice(0, max) + '\n…[truncated]' : text
}
