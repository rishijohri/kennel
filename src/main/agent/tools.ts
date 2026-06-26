import { spawn } from 'node:child_process'
import { existsSync, promises as fs, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Permissions } from '@shared/types'
import { webSearch } from '../services/websearch'
import { callMcpTool } from '../services/mcp'

export interface ToolDef {
  name: string
  description: string
  /** JSON Schema for the tool input. */
  schema: Record<string, unknown>
}

export interface ToolContext {
  cwd: string
  permissions: Permissions
  signal: AbortSignal
  /** Stream shell output (and similar) to the renderer. */
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void
  /**
   * Extra absolute roots that may be READ / searched / executed but live outside
   * cwd (e.g. a Park run's read-only frozen codebase mounted under the workspace).
   */
  allowRoots?: string[]
  /** Absolute roots where writes are rejected (read-only mounts like the codebase). */
  readonlyRoots?: string[]
  /** Extra environment variables for run_bash (merged over process.env). */
  env?: Record<string, string>
}

export interface ToolResult {
  ok: boolean
  content: string
}

const CORE_MEMORY_HINT = 'KENNEL.md or the .kennel/ directory'

/** Test against a NORMALIZED, cwd-relative path (never the raw model input). */
function isCoreMemory(relFromCwd: string): boolean {
  const p = relFromCwd.split('\\').join('/')
  return p === 'KENNEL.md' || p === '.kennel' || p.startsWith('.kennel/')
}

/** The cwd-relative, normalized form of an absolute path (POSIX separators). */
function relInside(cwd: string, abs: string): string {
  return relative(cwd, abs).split('\\').join('/')
}

/** True if `abs` is `root` or strictly contained within it. */
function isInside(root: string, abs: string): boolean {
  const rel = relative(root, abs)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Walk up to the nearest existing ancestor so we can realpath a not-yet-created file. */
function nearestExisting(p: string): string {
  let cur = p
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return realpathSync(cur)
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return cur
      cur = parent
    }
  }
}

/**
 * Models frequently prepend the project folder name to a path
 * (e.g. "myrepo/src/x.ts" instead of "src/x.ts"). Strip a leading
 * project-basename segment so those calls resolve correctly.
 */
function normalizeRelInput(cwd: string, p: string): string {
  let s = p.trim().split('\\').join('/').replace(/^\.\//, '')
  const base = basename(cwd)
  while (base && (s === base || s.startsWith(base + '/'))) {
    s = s === base ? '' : s.slice(base.length + 1)
  }
  return s || '.'
}

/**
 * Resolve a user-supplied path inside cwd, rejecting traversal escapes AND
 * symlink escapes. Tolerates a leading project-folder prefix the model often
 * prepends, but only strips it when the literal path doesn't already exist —
 * so a genuine subdir that shares the project's name is never mis-stripped.
 *
 * `allowRoots` are additional absolute roots the path may legitimately resolve
 * into (e.g. a workflow's read-only codebase mounted under the workspace via a
 * symlink). The path is accepted if it stays within cwd OR any allow-root, both
 * textually and after symlink resolution.
 */
function safeResolve(cwd: string, p: string, allowRoots: string[] = []): string {
  const raw = p.trim()
  const candidates: string[] = []
  if (isAbsolute(raw)) {
    candidates.push(raw)
  } else {
    const cleaned = raw.split('\\').join('/').replace(/^\.\//, '') || '.'
    candidates.push(resolve(cwd, cleaned))
    const strippedAbs = resolve(cwd, normalizeRelInput(cwd, raw))
    if (strippedAbs !== candidates[0]) candidates.push(strippedAbs)
  }
  // Prefer an existing target; for new files prefer one whose parent dir exists.
  const abs =
    candidates.find((c) => existsSync(c)) ??
    candidates.find((c) => existsSync(dirname(c))) ??
    candidates[0]

  const roots = [cwd, ...allowRoots]
  if (!roots.some((r) => isInside(r, abs))) {
    throw new Error(`Path "${p}" is outside the allowed roots and is not allowed.`)
  }
  // Defend against symlinks that escape every allowed root after normalization.
  try {
    const realRoots = roots.map(realpathOrSelf)
    const realAbs = nearestExisting(abs)
    if (!realRoots.some((r) => isInside(r, realAbs))) {
      throw new Error(`Path "${p}" resolves outside the allowed roots and is not allowed.`)
    }
  } catch (err: any) {
    if (err?.message?.includes('allowed roots')) throw err
    // realpath failed for benign reasons (e.g. nothing exists yet) — the
    // textual check above already passed, so allow.
  }
  return abs
}

// ── Tool catalogue (gated by permissions) ───────────────────────────────────

const readFileTool: ToolDef = {
  name: 'read_file',
  description:
    'Read the full UTF-8 contents of a file in the project. Use this to understand code before changing it.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the project root.' }
    },
    required: ['path']
  }
}

const listDirTool: ToolDef = {
  name: 'list_dir',
  description: 'List the entries (files and folders) of a directory in the project.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path relative to root. Use "." for root.' }
    },
    required: ['path']
  }
}

const searchTool: ToolDef = {
  name: 'search_code',
  description:
    'Search the project for a substring or regular expression. Returns matching files and line numbers.',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Substring or regex to search for.' },
      regex: { type: 'boolean', description: 'Treat query as a regular expression.' }
    },
    required: ['query']
  }
}

const writeFileTool: ToolDef = {
  name: 'write_file',
  description:
    'Create a new file or completely overwrite an existing one with the given contents. Parent directories are created automatically.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the project root.' },
      content: { type: 'string', description: 'The full file contents to write.' }
    },
    required: ['path', 'content']
  }
}

const editFileTool: ToolDef = {
  name: 'edit_file',
  description:
    'Replace an exact substring in a file with new text. The old_string must appear exactly once. Prefer this for targeted edits.',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the project root.' },
      old_string: { type: 'string', description: 'Exact text to replace (must be unique).' },
      new_string: { type: 'string', description: 'Replacement text.' }
    },
    required: ['path', 'old_string', 'new_string']
  }
}

const bashTool: ToolDef = {
  name: 'run_bash',
  description:
    'Run a shell command in the project root and return its combined stdout/stderr and exit code. Use for builds, tests, installs, git, etc.',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute.' }
    },
    required: ['command']
  }
}

const webSearchTool: ToolDef = {
  name: 'web_search',
  description:
    'Search the public web and return the top results (title, URL, snippet). Use this to find current information, documentation, or references beyond the codebase.',
  schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query.' } },
    required: ['query']
  }
}

export function buildToolset(perms: Permissions): ToolDef[] {
  const tools: ToolDef[] = [readFileTool, listDirTool, searchTool]
  if (perms.canEditFiles) tools.push(writeFileTool, editFileTool)
  if (perms.canRunBash) tools.push(bashTool)
  if (perms.canSearchWeb) tools.push(webSearchTool)
  // MCP tools are async to gather (they require connecting to servers); the run
  // setup appends them via getMcpToolDefs() when perms.canUseMcp is set.
  return tools
}

// ── Executor ────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const input = (rawInput ?? {}) as Record<string, any>
  try {
    switch (name) {
      case 'read_file':
        return await doRead(ctx, String(input.path ?? ''))
      case 'list_dir':
        return await doList(ctx, String(input.path ?? '.'))
      case 'search_code':
        return await doSearch(ctx.cwd, String(input.query ?? ''), Boolean(input.regex))
      case 'write_file':
        return await doWrite(ctx, String(input.path ?? ''), String(input.content ?? ''))
      case 'edit_file':
        return await doEdit(
          ctx,
          String(input.path ?? ''),
          String(input.old_string ?? ''),
          String(input.new_string ?? '')
        )
      case 'run_bash':
        return await doBash(ctx, String(input.command ?? ''))
      case 'web_search':
        return await doWebSearch(ctx, String(input.query ?? ''))
      default:
        // Tools from MCP servers are namespaced mcp__<server>__<tool>.
        if (name.startsWith('mcp__')) {
          if (!ctx.permissions.canUseMcp) {
            throw new Error('This persona does not have permission to use MCP tools.')
          }
          return await callMcpTool(name, rawInput)
        }
        return { ok: false, content: `Unknown tool: ${name}` }
    }
  } catch (err: any) {
    return { ok: false, content: `Error: ${err?.message ?? String(err)}` }
  }
}

async function doWebSearch(ctx: ToolContext, query: string): Promise<ToolResult> {
  if (!ctx.permissions.canSearchWeb) {
    throw new Error('This persona does not have permission to search the web.')
  }
  if (!query.trim()) return { ok: false, content: 'Empty query.' }
  const results = await webSearch(query.trim(), 8, ctx.signal)
  if (results.length === 0) return { ok: true, content: `No results for "${query}".` }
  const text = results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join('\n\n')
  return { ok: true, content: text }
}

async function doRead(ctx: ToolContext, path: string): Promise<ToolResult> {
  const abs = safeResolve(ctx.cwd, path, ctx.allowRoots)
  const buf = await fs.readFile(abs)
  const text = buf.toString('utf8')
  const max = 60_000
  const clipped = text.length > max ? text.slice(0, max) + '\n…[truncated]' : text
  return { ok: true, content: clipped }
}

async function doList(ctx: ToolContext, path: string): Promise<ToolResult> {
  const abs = safeResolve(ctx.cwd, path, ctx.allowRoots)
  const entries = await fs.readdir(abs, { withFileTypes: true })
  const lines = entries
    .filter((e) => e.name !== '.git')
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
  return { ok: true, content: lines.join('\n') || '(empty)' }
}

const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'release', '.next'])

async function doSearch(cwd: string, query: string, useRegex: boolean): Promise<ToolResult> {
  if (!query) return { ok: false, content: 'Empty query.' }
  const matcher = useRegex
    ? new RegExp(query, 'i')
    : { test: (s: string) => s.toLowerCase().includes(query.toLowerCase()) }
  const results: string[] = []
  const maxResults = 80

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxResults) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (results.length >= maxResults) return
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue
        await walk(join(dir, e.name))
      } else if (e.isFile()) {
        const full = join(dir, e.name)
        let content: string
        try {
          const buf = await fs.readFile(full)
          if (buf.includes(0)) continue // skip binary
          content = buf.toString('utf8')
        } catch {
          continue
        }
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (matcher.test(lines[i])) {
            results.push(`${relative(cwd, full)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
            if (results.length >= maxResults) break
          }
        }
      }
    }
  }

  await walk(cwd)
  return {
    ok: true,
    content: results.length ? results.join('\n') : `No matches for "${query}".`
  }
}

/** Enforce edit + core-memory + read-only-mount rules on a resolved absolute path. */
function guardWrite(ctx: ToolContext, abs: string): void {
  if (!ctx.permissions.canEditFiles) {
    throw new Error('This persona does not have permission to edit files.')
  }
  // Read-only mounts (e.g. a workflow's frozen codebase) can't be written.
  if (ctx.readonlyRoots?.length) {
    const real = nearestExisting(abs)
    if (ctx.readonlyRoots.some((r) => isInside(realpathOrSelf(r), real))) {
      throw new Error(
        'The codebase is read-only in a workflow — write created files to the workspace instead.'
      )
    }
  }
  if (isCoreMemory(relInside(ctx.cwd, abs)) && !ctx.permissions.canEditCoreMemory) {
    throw new Error(
      `Editing core memory (${CORE_MEMORY_HINT}) is not permitted for this persona.`
    )
  }
}

async function doWrite(ctx: ToolContext, path: string, content: string): Promise<ToolResult> {
  const abs = safeResolve(ctx.cwd, path, ctx.allowRoots)
  guardWrite(ctx, abs)
  await fs.mkdir(resolve(abs, '..'), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
  return { ok: true, content: `Wrote ${content.length} bytes to ${path}.` }
}

async function doEdit(
  ctx: ToolContext,
  path: string,
  oldStr: string,
  newStr: string
): Promise<ToolResult> {
  const abs = safeResolve(ctx.cwd, path, ctx.allowRoots)
  guardWrite(ctx, abs)
  const original = await fs.readFile(abs, 'utf8')
  const occurrences = original.split(oldStr).length - 1
  if (occurrences === 0) {
    return { ok: false, content: `old_string not found in ${path}.` }
  }
  if (occurrences > 1) {
    return {
      ok: false,
      content: `old_string appears ${occurrences} times in ${path}; it must be unique. Add more surrounding context.`
    }
  }
  const updated = original.replace(oldStr, newStr)
  await fs.writeFile(abs, updated, 'utf8')
  return { ok: true, content: `Edited ${path}.` }
}

async function doBash(ctx: ToolContext, command: string): Promise<ToolResult> {
  if (!ctx.permissions.canRunBash) {
    throw new Error('This persona does not have permission to run shell commands.')
  }
  if (!command.trim()) return { ok: false, content: 'Empty command.' }

  return new Promise<ToolResult>((resolveP) => {
    const child = spawn(command, {
      cwd: ctx.cwd,
      shell: true,
      signal: ctx.signal,
      env: ctx.env ? { ...process.env, ...ctx.env } : process.env
    })
    let out = ''
    const cap = (text: string) => {
      out += text
      if (out.length > 40_000) out = out.slice(-40_000)
    }
    child.stdout.on('data', (d) => {
      const t = d.toString()
      cap(t)
      ctx.onOutput?.('stdout', t)
    })
    child.stderr.on('data', (d) => {
      const t = d.toString()
      cap(t)
      ctx.onOutput?.('stderr', t)
    })
    child.on('error', (err) => {
      resolveP({ ok: false, content: `Failed to run: ${err.message}` })
    })
    child.on('close', (code) => {
      resolveP({
        ok: code === 0,
        content: `$ ${command}\n${out.trim() || '(no output)'}\n[exit ${code}]`
      })
    })
  })
}
