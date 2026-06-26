import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DiffStat } from '@shared/types'

const pexec = promisify(execFile)

const MAX_BUFFER = 64 * 1024 * 1024 // 64MB — large diffs / file listings

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexec('git', args, { cwd, maxBuffer: MAX_BUFFER })
  return stdout
}

/** Like git() but never throws — returns '' on failure. Useful for probes. */
async function gitSafe(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args)
  } catch {
    return ''
  }
}

async function isRepo(cwd: string): Promise<boolean> {
  const out = await gitSafe(cwd, ['rev-parse', '--is-inside-work-tree'])
  return out.trim() === 'true'
}

async function hasCommits(cwd: string): Promise<boolean> {
  const out = await gitSafe(cwd, ['rev-parse', '--verify', 'HEAD'])
  return out.trim().length > 0
}

async function isDirty(cwd: string): Promise<boolean> {
  const out = await gitSafe(cwd, ['status', '--porcelain'])
  return out.trim().length > 0
}

async function ensureIdentity(cwd: string): Promise<void> {
  const email = (await gitSafe(cwd, ['config', 'user.email'])).trim()
  if (!email) await gitSafe(cwd, ['config', 'user.email', 'agent@kennel.dev'])
  const name = (await gitSafe(cwd, ['config', 'user.name'])).trim()
  if (!name) await gitSafe(cwd, ['config', 'user.name', 'Kennel'])
}

/**
 * Make sure `path` is a git repo with at least one commit and a clean tree,
 * then return the SHA that becomes the project's root node.
 */
export async function ensureRepo(path: string): Promise<string> {
  if (!(await isRepo(path))) {
    await git(path, ['init'])
  }
  await ensureIdentity(path)

  if (!(await hasCommits(path))) {
    await git(path, ['add', '-A'])
    await git(path, ['commit', '--allow-empty', '-m', 'kennel: initial import'])
  } else if (await isDirty(path)) {
    await git(path, ['add', '-A'])
    await git(path, ['commit', '--allow-empty', '-m', 'kennel: snapshot on open'])
  }
  return (await git(path, ['rev-parse', 'HEAD'])).trim()
}

/** Pin a commit under refs/kennel/<nodeId> so it is never garbage-collected. */
export async function pinNode(path: string, nodeId: string, commit: string): Promise<void> {
  await git(path, ['update-ref', `refs/kennel/${nodeId}`, commit])
}

export async function unpinNode(path: string, nodeId: string): Promise<void> {
  await gitSafe(path, ['update-ref', '-d', `refs/kennel/${nodeId}`])
}

/**
 * Force the working tree to exactly match `commit` (detached HEAD).
 * Used when the user selects a node — the folder then reflects that state.
 * `checkout --force` resets tracked files; `clean -fd` removes untracked files
 * that don't belong to this commit so they can't leak into the next snapshot.
 * Ignored files (node_modules, build output) are left untouched (no `-x`).
 */
export async function checkoutCommit(path: string, commit: string): Promise<void> {
  await git(path, ['checkout', '--force', '--detach', commit])
  await gitSafe(path, ['clean', '-fd'])
}

/**
 * Stage everything and commit on top of the currently checked-out commit,
 * producing a new child commit. Returns the new SHA.
 */
export async function commitState(path: string, message: string): Promise<string> {
  await git(path, ['add', '-A'])
  await git(path, ['commit', '--allow-empty', '-m', message])
  return (await git(path, ['rev-parse', 'HEAD'])).trim()
}

/**
 * Materialize `commit` into a fresh, detached git worktree at `worktreePath`.
 * Used to give a Park workflow run an isolated, real checkout of the codebase
 * (frozen at the Park's base commit) without ever touching the main working tree.
 */
export async function addWorktree(
  repoPath: string,
  worktreePath: string,
  commit: string
): Promise<void> {
  await git(repoPath, ['worktree', 'add', '--detach', worktreePath, commit])
}

/** Remove a worktree created with addWorktree (best-effort; never throws). */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  await gitSafe(repoPath, ['worktree', 'remove', '--force', worktreePath])
  // Drop any stale administrative entry if the dir was already gone.
  await gitSafe(repoPath, ['worktree', 'prune'])
}

/** Recursive file listing for a commit, without touching the working tree. */
export async function listTree(path: string, commit: string): Promise<string[]> {
  const out = await gitSafe(path, ['ls-tree', '-r', '--name-only', commit])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** File contents at a commit, read from the object store (no checkout). */
export async function showFile(path: string, commit: string, relPath: string): Promise<string> {
  return gitSafe(path, ['show', `${commit}:${relPath}`])
}

/** Like showFile but THROWS if the path is absent/errored (vs returning '') — lets
 *  callers distinguish a genuinely empty file from a missing one. */
export async function showFileStrict(path: string, commit: string, relPath: string): Promise<string> {
  return git(path, ['show', `${commit}:${relPath}`])
}

/** Unified diff between two commits. */
export async function diff(path: string, fromCommit: string, toCommit: string): Promise<string> {
  return gitSafe(path, ['diff', '--no-color', fromCommit, toCommit])
}

export async function diffStat(
  path: string,
  fromCommit: string,
  toCommit: string
): Promise<DiffStat> {
  const out = await gitSafe(path, ['diff', '--numstat', fromCommit, toCommit])
  let insertions = 0
  let deletions = 0
  let filesChanged = 0
  for (const line of out.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const [add, del] = t.split('\t')
    filesChanged += 1
    if (add !== '-') insertions += Number(add) || 0
    if (del !== '-') deletions += Number(del) || 0
  }
  return { filesChanged, insertions, deletions }
}

/** Short one-line summary of changed files for a node title/summary. */
export async function changedFiles(
  path: string,
  fromCommit: string,
  toCommit: string
): Promise<string[]> {
  const out = await gitSafe(path, ['diff', '--name-only', fromCommit, toCommit])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export interface NameStatusEntry {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T'
  path: string
  oldPath?: string
}

/** Per-file change list with git status (A/M/D/R/C/T). Renames/copies carry oldPath. */
export async function nameStatus(
  path: string,
  fromCommit: string,
  toCommit: string
): Promise<NameStatusEntry[]> {
  // -z gives NUL-separated records; rename/copy emit status\0old\0new, others status\0path.
  const out = await gitSafe(path, ['diff', '--name-status', '-z', fromCommit, toCommit])
  const parts = out.split('\0').filter((p) => p.length > 0)
  const entries: NameStatusEntry[] = []
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++]
    const letter = code[0] as NameStatusEntry['status']
    if (letter === 'R' || letter === 'C') {
      const oldPath = parts[i++]
      const newPath = parts[i++]
      entries.push({ status: letter, path: newPath, oldPath })
    } else if ('AMDT'.includes(letter)) {
      entries.push({ status: letter, path: parts[i++] })
    } else {
      // Unknown/unmerged — surface as a modification so it's still viewable.
      entries.push({ status: 'M', path: parts[i++] })
    }
  }
  return entries
}

export async function currentHead(path: string): Promise<string> {
  return (await git(path, ['rev-parse', 'HEAD'])).trim()
}
