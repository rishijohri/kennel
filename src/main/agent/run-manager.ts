import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type {
  CanvasNode,
  CreateAgenticRunInput,
  CreateDeterministicRunInput,
  ResultStateKind,
  ResultStateRule,
  RunEvent,
  RunProcessInput
} from '@shared/types'
import { store } from '../services/store'
import { sendRunEvent, sendState } from '../services/broadcast'
import {
  changedFiles,
  checkoutCommit,
  commitState,
  diffStat,
  pinNode
} from '../services/git'
import { buildToolset, executeTool, type ToolContext } from './tools'
import { getMcpToolDefs } from '../services/mcp'
import { runWithProvider } from './provider-runner'
import { applyInputs, inferResult, type ExecutionResult } from './result-infer'
import type { AgentStreamEvent } from './provider-types'

/** Rules for ad-hoc deterministic commands (no process template). */
const DEFAULT_RULES: ResultStateRule[] = [
  { state: 'success', kind: 'success', when: 'exit-zero' },
  { state: 'failed', kind: 'failure', when: 'exit-nonzero' },
  { state: 'failed to start', kind: 'failure', when: 'spawn-error' }
]

const active = new Map<string, AbortController>()

/** A run mutates the single working tree, so only one may proceed at a time. */
export function isBusy(): boolean {
  return active.size > 0
}

export function cancelRun(runId: string): void {
  active.get(runId)?.abort()
}

// ── Live deterministic-node monitoring ───────────────────────────────────────
// So an orchestrator (the Walker) can watch a long deterministic step's output
// as it streams, decide if it's going wrong, and stop it mid-run.

interface LiveNode {
  runId: string
  output: string
  done: boolean
}
const liveNodes = new Map<string, LiveNode>()
const LIVE_CAP = 40

/** Begin tracking a deterministic node's live output (prunes the oldest). */
function trackLiveNode(nodeId: string, runId: string): void {
  liveNodes.set(nodeId, { runId, output: '', done: false })
  while (liveNodes.size > LIVE_CAP) {
    const oldest = liveNodes.keys().next().value
    if (oldest === undefined) break
    liveNodes.delete(oldest)
  }
}

/** The tail of a node's output + whether it is still running. Null if unknown. */
export function peekNodeOutput(
  nodeId: string,
  tailChars = 4000
): { running: boolean; output: string } | null {
  const ln = liveNodes.get(nodeId)
  if (!ln) return null
  const out = ln.output.length > tailChars ? '…' + ln.output.slice(-tailChars) : ln.output
  return { running: !ln.done, output: out }
}

/** Abort a running deterministic node by its node id. Returns whether it stopped. */
export function stopNode(nodeId: string): boolean {
  const ln = liveNodes.get(nodeId)
  if (!ln || ln.done) return false
  active.get(ln.runId)?.abort()
  return true
}

/** Resolve once a node's run finishes (or the signal aborts). */
export function awaitNodeDone(nodeId: string, signal: AbortSignal): Promise<void> {
  const ln = liveNodes.get(nodeId)
  if (!ln || ln.done) return Promise.resolve()
  return new Promise((resolve) => {
    let off = () => {}
    const settle = () => {
      off()
      signal.removeEventListener('abort', settle)
      resolve()
    }
    off = observeRuns((e) => {
      if (e.nodeId === nodeId && (e.type === 'done' || e.type === 'error')) settle()
    })
    if (signal.aborted) settle()
    else signal.addEventListener('abort', settle)
  })
}

/** Hold the single working tree under a token (e.g. a running Park workflow) so
 *  `isBusy()` is true and the main canvas can't run concurrently. */
export function holdWorkingTree(token: string, controller: AbortController): void {
  active.set(token, controller)
}

export function releaseWorkingTree(token: string): void {
  active.delete(token)
}

// ── In-process run observers ─────────────────────────────────────────────────
// The Walker orchestrator runs in the same process and needs to await a node's
// completion and read its full activity. Every run event is mirrored to any
// in-process observers in addition to being broadcast to the renderer.

export type RunObserver = (e: RunEvent) => void
const observers = new Set<RunObserver>()

/** Subscribe to all run events in-process. Returns an unsubscribe function. */
export function observeRuns(fn: RunObserver): () => void {
  observers.add(fn)
  return () => observers.delete(fn)
}

function emit(e: RunEvent): void {
  sendRunEvent(e)
  for (const o of observers) {
    try {
      o(e)
    } catch {
      // An observer must never break the run loop.
    }
  }
}

function summarize(text: string, fallback: string): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
  const s = firstLine || fallback
  return s.length > 140 ? s.slice(0, 140) + '…' : s
}

/**
 * Walk up the parent chain from `parentId` and return the NEAREST ancestor's
 * instructions (set by an Instructor node). The closest Instructor wins, so a
 * deeper Instructor node overrides a shallower one for its sub-branch.
 */
export function nearestInstructions(parentId: string | null): string | undefined {
  let cur = parentId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n = store.getNode(cur)
    if (!n) break
    const text = n.instructions?.trim()
    if (text) return text
    cur = n.parentId
  }
  return undefined
}

/** A clearly-delimited, authoritative instructions block for the system prompt. */
const INSTRUCTIONS_BLOCK = (text: string) =>
  `\n\nACTIVE INSTRUCTIONS — set by an Instructor node above you in the graph. ` +
  `Treat these as binding direction for this task; follow them exactly:\n${text}\n`

const SYSTEM_PREAMBLE = (projectName: string) =>
  `You are an autonomous coding agent operating inside Kennel, a node-based IDE.\n` +
  `The project "${projectName}" is checked out in your working directory.\n` +
  `Tool file paths MUST be relative to the project root, with NO leading project-folder name and NO absolute prefix. ` +
  `Use "src/index.ts" — NOT "${projectName}/src/index.ts" and NOT "/Users/.../${projectName}/src/index.ts". Use "." for the root directory.\n` +
  `Use your tools to inspect and modify the codebase to accomplish the user's request. Work carefully and verify when you can.\n` +
  `The protected core memory lives in KENNEL.md and the .kennel/ directory — only modify it if explicitly permitted.\n` +
  `When you are finished, end with a concise summary of what you changed.\n\n`

// ── Agentic run ──────────────────────────────────────────────────────────────

export async function startAgenticRun(
  input: CreateAgenticRunInput
): Promise<{ runId: string; nodeId: string }> {
  const project = store.getProject()
  if (!project) throw new Error('No project is open.')
  const parent = store.getNode(input.parentNodeId)
  if (!parent) throw new Error('Parent node not found.')
  const persona = store.getPersona(input.personaId)
  if (!persona) throw new Error('Persona not found.')
  const provider = store.getProvider(persona.providerId)
  if (!provider) throw new Error('This persona has no provider configured.')
  const apiKey = store.getApiKey(persona.providerId) ?? ''
  // openai-compatible may be keyless; Vertex may use project+location instead of a key.
  const vertexWithAdc =
    provider.kind === 'google-vertex' && Boolean(provider.project) && Boolean(provider.location)
  const keyOptional = provider.kind === 'openai-compatible' || vertexWithAdc
  if (!keyOptional && !apiKey) {
    throw new Error(`No API key set for provider "${provider.name}".`)
  }
  if (isBusy()) throw new Error('A run is already in progress. Wait for it to finish.')

  const runId = randomUUID()
  const nodeId = randomUUID()
  const controller = new AbortController()
  active.set(runId, controller)

  const node: CanvasNode = {
    id: nodeId,
    parentId: parent.id,
    commit: parent.commit,
    title: persona.name,
    kind: 'agentic',
    status: 'running',
    personaId: persona.id,
    prompt: input.prompt,
    createdAt: Date.now(),
    position: input.position
  }
  store.upsertNode(node)
  sendState(store.getState())
  emit({ runId, nodeId, type: 'start', at: Date.now() })

  // Run asynchronously; the IPC caller already has the ids.
  void (async () => {
    try {
      emit({ runId, nodeId, type: 'status', text: `Checking out ${parent.title}…` })
      await checkoutCommit(project.path, parent.commit)

      const toolCtx: ToolContext = {
        cwd: project.path,
        permissions: persona.permissions,
        signal: controller.signal,
        onOutput: (stream, text) => emit({ runId, nodeId, type: 'output', stream, text })
      }
      const tools = [
        ...buildToolset(persona.permissions),
        ...(persona.permissions.canUseMcp ? await getMcpToolDefs() : [])
      ]
      const execute = (name: string, toolInput: unknown) => executeTool(name, toolInput, toolCtx)

      const onEvent = (ev: AgentStreamEvent) => {
        if (ev.type === 'thinking') emit({ runId, nodeId, type: 'thinking', text: ev.text })
        else if (ev.type === 'assistant') emit({ runId, nodeId, type: 'assistant', text: ev.text })
        else if (ev.type === 'status') emit({ runId, nodeId, type: 'status', text: ev.text })
        else if (ev.type === 'tool_call')
          emit({
            runId,
            nodeId,
            type: 'tool_call',
            tool: ev.tool,
            input: ev.input,
            callId: ev.callId
          })
        else if (ev.type === 'tool_result')
          emit({
            runId,
            nodeId,
            type: 'tool_result',
            callId: ev.callId,
            ok: ev.ok,
            preview: ev.preview
          })
      }

      // Inherit the nearest Instructor ancestor's instructions (if any) so every
      // agentic descendant follows the direction set above it.
      const inherited = nearestInstructions(parent.id)

      const runOptions = {
        apiKey,
        baseUrl: provider.baseUrl,
        model: persona.model,
        systemPrompt:
          SYSTEM_PREAMBLE(project.name) +
          persona.systemPrompt +
          (inherited ? INSTRUCTIONS_BLOCK(inherited) : ''),
        userPrompt: input.prompt,
        effort: persona.effort,
        tools,
        execute,
        emit: onEvent,
        signal: controller.signal,
        vertex: provider.kind === 'google-vertex',
        project: provider.project,
        location: provider.location
      }

      emit({ runId, nodeId, type: 'status', text: `${persona.name} is working…` })
      const result = await runWithProvider(provider.kind, runOptions)

      // An Instructor's output IS the instruction set for its descendants.
      const produced = persona.isInstructor ? result.finalText.trim().slice(0, 4000) : undefined

      await finalizeNode(runId, nodeId, parent.commit, project.path, {
        message: `kennel(${persona.name}): ${input.prompt.slice(0, 72)}`,
        summary: summarize(result.finalText, `${persona.name} ran`),
        status: 'done',
        instructions: produced
      })
    } catch (err: any) {
      await finalizeError(runId, nodeId, parent.commit, project.path, err)
    } finally {
      active.delete(runId)
    }
  })()

  return { runId, nodeId }
}

// ── Deterministic run ────────────────────────────────────────────────────────

export async function startDeterministicRun(
  input: CreateDeterministicRunInput
): Promise<{ runId: string; nodeId: string }> {
  const project = store.getProject()
  if (!project) throw new Error('No project is open.')
  const parent = store.getNode(input.parentNodeId)
  if (!parent) throw new Error('Parent node not found.')
  if (isBusy()) throw new Error('A run is already in progress. Wait for it to finish.')

  // Register the quick command as a reusable canvas process (deduped by command)
  // so every deterministic node is registry-backed and listed in the sidebar.
  const proc = store.findOrCreateCommandProcess('canvas', input.title, input.command)
  const rules = proc?.resultRules.length ? proc.resultRules : DEFAULT_RULES

  const runId = randomUUID()
  const nodeId = randomUUID()
  const controller = new AbortController()
  active.set(runId, controller)
  trackLiveNode(nodeId, runId)

  const node: CanvasNode = {
    id: nodeId,
    parentId: parent.id,
    commit: parent.commit,
    title: proc?.name || input.title || 'Task',
    kind: 'deterministic',
    status: 'running',
    command: input.command,
    processId: proc?.id,
    createdAt: Date.now(),
    position: input.position
  }
  store.upsertNode(node)
  sendState(store.getState())
  emit({ runId, nodeId, type: 'start', at: Date.now() })

  void (async () => {
    try {
      emit({ runId, nodeId, type: 'status', text: `Checking out ${parent.title}…` })
      await checkoutCommit(project.path, parent.commit)
      emit({ runId, nodeId, type: 'status', text: `$ ${input.command}` })

      const exec = await runShellCapture(runId, nodeId, input.command, project.path, controller)
      const inferred = inferResult(rules, exec)

      await finalizeNode(runId, nodeId, parent.commit, project.path, {
        message: `kennel(task): ${input.command.slice(0, 72)}`,
        summary: `${inferred.state}: ${input.command}`,
        status: exec.spawnError ? 'error' : 'done',
        resultState: inferred.state,
        resultStateKind: inferred.kind
      })
    } catch (err: any) {
      await finalizeError(runId, nodeId, parent.commit, project.path, err)
    } finally {
      active.delete(runId)
    }
  })()

  return { runId, nodeId }
}

// ── Deterministic process run (reusable, parameterized) ──────────────────────

export async function startProcessRun(
  input: RunProcessInput
): Promise<{ runId: string; nodeId: string }> {
  const project = store.getProject()
  if (!project) throw new Error('No project is open.')
  const parent = store.getNode(input.parentNodeId)
  if (!parent) throw new Error('Parent node not found.')
  const process = store.getProcess(input.processId)
  if (!process) throw new Error('Deterministic process not found.')
  if (isBusy()) throw new Error('A run is already in progress. Wait for it to finish.')

  // Resolve inputs (apply defaults) and validate required ones.
  const inputs: Record<string, string> = {}
  for (const inp of process.inputs) {
    const provided = input.inputs[inp.name]
    const value = provided != null && provided.trim() !== '' ? provided : (inp.default ?? '')
    if (inp.required && !value.trim()) throw new Error(`Missing required input "${inp.name}".`)
    inputs[inp.name] = value
  }
  const command = applyInputs(process.command, inputs)

  const runId = randomUUID()
  const nodeId = randomUUID()
  const controller = new AbortController()
  active.set(runId, controller)
  trackLiveNode(nodeId, runId)

  const node: CanvasNode = {
    id: nodeId,
    parentId: parent.id,
    commit: parent.commit,
    title: process.name,
    kind: 'deterministic',
    status: 'running',
    command,
    processId: process.id,
    inputs,
    createdAt: Date.now(),
    position: input.position
  }
  store.upsertNode(node)
  sendState(store.getState())
  emit({ runId, nodeId, type: 'start', at: Date.now() })

  void (async () => {
    try {
      emit({ runId, nodeId, type: 'status', text: `Checking out ${parent.title}…` })
      await checkoutCommit(project.path, parent.commit)
      emit({ runId, nodeId, type: 'status', text: `$ ${command}` })

      const exec = await runShellCapture(runId, nodeId, command, project.path, controller)
      const inferred = inferResult(process.resultRules, exec)

      await finalizeNode(runId, nodeId, parent.commit, project.path, {
        message: `kennel(${process.name}): ${command.slice(0, 64)}`,
        summary: `${process.name} → ${inferred.state}`,
        status: exec.spawnError ? 'error' : 'done',
        resultState: inferred.state,
        resultStateKind: inferred.kind
      })
    } catch (err: any) {
      await finalizeError(runId, nodeId, parent.commit, project.path, err)
    } finally {
      active.delete(runId)
    }
  })()

  return { runId, nodeId }
}

// ── Shell execution + finalization (commit + node update) ────────────────────

/** Run a shell command, streaming output and capturing the result for inference. */
function runShellCapture(
  runId: string,
  nodeId: string,
  command: string,
  cwd: string,
  controller: AbortController
): Promise<ExecutionResult> {
  return new Promise((resolveP, rejectP) => {
    let output = ''
    let settled = false
    const cap = (t: string) => {
      output += t
      if (output.length > 60_000) output = output.slice(-60_000)
      const ln = liveNodes.get(nodeId)
      if (ln) ln.output = output
    }
    const child = spawn(command, { cwd, shell: true, signal: controller.signal, env: process.env })
    child.stdout.on('data', (d) => {
      const t = d.toString()
      cap(t)
      emit({ runId, nodeId, type: 'output', stream: 'stdout', text: t })
    })
    child.stderr.on('data', (d) => {
      const t = d.toString()
      cap(t)
      emit({ runId, nodeId, type: 'output', stream: 'stderr', text: t })
    })
    child.on('error', (e: any) => {
      if (settled) return
      settled = true
      // A user cancel aborts the spawn — route it as a cancelled run, not a
      // "failed to start" spawn error.
      if (controller.signal.aborted || e?.name === 'AbortError') {
        return rejectP(new Error('Run cancelled.'))
      }
      cap(e.message)
      emit({ runId, nodeId, type: 'output', stream: 'stderr', text: e.message })
      resolveP({ spawnError: true, exitCode: null, output })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (controller.signal.aborted) return rejectP(new Error('Run cancelled.'))
      resolveP({ spawnError: false, exitCode: code ?? null, output })
    })
  })
}

async function finalizeNode(
  runId: string,
  nodeId: string,
  parentCommit: string,
  path: string,
  opts: {
    message: string
    summary: string
    status: CanvasNode['status']
    resultState?: string
    resultStateKind?: ResultStateKind
    /** Instructions an Instructor node established (propagate to descendants). */
    instructions?: string
  }
): Promise<void> {
  const ln = liveNodes.get(nodeId)
  if (ln) ln.done = true
  emit({ runId, nodeId, type: 'status', text: 'Committing snapshot…' })
  const newCommit = await commitState(path, opts.message)
  await pinNode(path, nodeId, newCommit)
  const stat = await diffStat(path, parentCommit, newCommit)
  const files = await changedFiles(path, parentCommit, newCommit)

  store.patchNode(nodeId, {
    commit: newCommit,
    status: opts.status,
    summary: opts.summary,
    diffStat: stat,
    resultState: opts.resultState,
    resultStateKind: opts.resultStateKind,
    instructions: opts.instructions
  })
  store.setActiveNode(nodeId)

  const node = store.getNode(nodeId)!
  const detail =
    stat.filesChanged > 0
      ? `${stat.filesChanged} file${stat.filesChanged === 1 ? '' : 's'} changed`
      : 'no file changes'
  emit({ runId, nodeId, type: 'status', text: detail + (files.length ? ` · ${files[0]}` : '') })
  emit({ runId, nodeId, type: 'done', node, at: Date.now() })
  sendState(store.getState())
}

async function finalizeError(
  runId: string,
  nodeId: string,
  parentCommit: string,
  path: string,
  err: any
): Promise<void> {
  const ln = liveNodes.get(nodeId)
  if (ln) ln.done = true
  const message = err?.message ?? String(err)
  try {
    // Preserve any partial work as a committed (error) node so the DAG stays valid.
    const newCommit = await commitState(path, `kennel(error): ${message.slice(0, 64)}`)
    await pinNode(path, nodeId, newCommit)
    const stat = await diffStat(path, parentCommit, newCommit)
    store.patchNode(nodeId, { commit: newCommit, status: 'error', error: message, diffStat: stat })
    store.setActiveNode(nodeId)
  } catch {
    store.patchNode(nodeId, { status: 'error', error: message })
  }
  emit({ runId, nodeId, type: 'error', message, at: Date.now() })
  sendState(store.getState())
}
