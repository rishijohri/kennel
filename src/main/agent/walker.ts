import type {
  ActivationCondition,
  CanvasNode,
  Park,
  RunEvent,
  WalkerAutonomy,
  WalkerMessage
} from '@shared/types'
import { parkCapVisible } from '@shared/park-scope'
import { subtreeIds, COLLAPSED_ID } from '@shared/tree'
import { store } from '../services/store'
import { sendState, sendWalkerEvent } from '../services/broadcast'
import { diff } from '../services/git'
import { type ToolDef } from './tools'
import { runWithProvider } from './provider-runner'
import { isCaretakerBusy, runCaretakerTurn } from './caretaker'
import {
  awaitNodeDone,
  cancelRun,
  isBusy,
  observeRuns,
  peekNodeOutput,
  startAgenticRun,
  startProcessRun,
  stopNode
} from './run-manager'
import {
  addWorkflowNode,
  createPark,
  deleteWorkflowNode,
  setParkObjective,
  updateWorkflowNode
} from '../services/parks'
import { cancelWorkflow, runWorkflow } from './workflow-runner'
import { deleteCanvasNode } from '../services/node-ops'
import { getNodeActivity } from '../services/activity-log'

let controller: AbortController | null = null

export function cancelWalker(): void {
  controller?.abort()
}

/** True while the Walker is actively working a task. */
export function isWalkerBusy(): boolean {
  return controller !== null
}

// ── Autonomy → operating envelope ────────────────────────────────────────────

const NODE_BUDGET: Record<WalkerAutonomy, number> = { low: 3, medium: 8, high: 25 }
/** In Park mode, how many times the Walker may run the whole workflow to iterate. */
const WORKFLOW_RUN_BUDGET: Record<WalkerAutonomy, number> = { low: 1, medium: 3, high: 6 }
const AUTONOMY_LABEL: Record<WalkerAutonomy, string> = {
  low: 'Cautious',
  medium: 'Balanced',
  high: 'Autonomous'
}
/** The Care Taker may be consulted (to create new capabilities) at these levels. */
const MAY_ASK_CARETAKER: Record<WalkerAutonomy, boolean> = { low: false, medium: true, high: true }

// ── Lookup helpers ───────────────────────────────────────────────────────────

/** True if `ancestorId` is a strict (transitive) parent of `nodeId` in the workflow tree. */
function isAncestorOf(nodes: Park['nodes'], ancestorId: string, nodeId: string): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let cur = byId.get(nodeId)?.parentId ?? null
  while (cur) {
    if (cur === ancestorId) return true
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}

/** Canvas vs Park scope: park personas/processes are a separate pool. */
function inScope(itemScope: 'canvas' | 'park' | undefined, want: 'canvas' | 'park'): boolean {
  return want === 'park' ? itemScope === 'park' : itemScope !== 'park'
}

/** Whether park caps are shared across the active project's Parks (default true). */
function parkShared(): boolean {
  return store.getProject()?.shareParkCapabilities !== false
}

/** Scope filter that also honors per-project cross-park isolation in Park mode. */
function inScopeForPark(
  item: { scope?: 'canvas' | 'park'; ownerParkId?: string; builtin?: string },
  want: 'canvas' | 'park',
  parkId: string | undefined
): boolean {
  if (want !== 'park') return inScope(item.scope, want)
  return parkCapVisible(item, parkId, parkShared())
}

function resolvePersona(target: unknown, scope: 'canvas' | 'park' = 'canvas', parkId?: string) {
  const raw = String(target ?? '').trim()
  const t = raw.toLowerCase()
  return store
    .getState()
    .personas.find((p) => (p.id === raw || p.name.toLowerCase() === t) && inScopeForPark(p, scope, parkId))
}

function resolveProcess(target: unknown, scope: 'canvas' | 'park' = 'canvas', parkId?: string) {
  const raw = String(target ?? '').trim()
  const t = raw.toLowerCase()
  return store
    .getState()
    .deterministicProcesses.find(
      (p) => (p.id === raw || p.name.toLowerCase() === t) && inScopeForPark(p, scope, parkId)
    )
}

/** A concise outcome report for a node: status, result-state, diff, output tail. */
function describeNode(nodeId: string, withOutput: boolean): string {
  const n = store.getNode(nodeId)
  if (!n) return `Node ${nodeId} not found.`
  const parts: string[] = [`Node ${n.id} "${n.title}" (${n.kind}) — ${n.status}`]
  if (n.resultState) parts.push(`result-state: ${n.resultState} (${n.resultStateKind})`)
  if (n.diffStat)
    parts.push(`diff: ${n.diffStat.filesChanged} file(s) +${n.diffStat.insertions}/-${n.diffStat.deletions}`)
  if (n.summary) parts.push(`summary: ${n.summary}`)
  if (n.error) parts.push(`error: ${n.error}`)
  if (withOutput) {
    const peek = peekNodeOutput(nodeId, 4000)
    if (peek) parts.push(`--- output (tail) ---\n${peek.output || '(no output)'}`)
  }
  return parts.join('\n')
}

/** Place a child below its parent, fanning siblings out horizontally. */
function spawnPosition(parentId: string): { x: number; y: number } {
  const nodes = store.getNodes()
  const parent = nodes.find((n) => n.id === parentId)
  const base = parent?.position ?? { x: 0, y: 0 }
  const siblings = nodes.filter((n) => n.parentId === parentId)
  return { x: base.x - 120 + siblings.length * 300, y: base.y + 200 }
}

function activeParentId(): string {
  const project = store.getProject()
  if (!project) return ''
  // When the canvas is collapsed/focused, the checked-out node may be HIDDEN
  // (outside the focused subtree). Spawning under it would create a node the
  // user can't see — so default new work to the focus node, keeping it visible.
  const focusId = project.focusedNodeId
  if (focusId) {
    const all = store.getNodes()
    if (all.some((n) => n.id === focusId) && !subtreeIds(all, focusId).has(project.activeNodeId)) {
      return focusId
    }
  }
  return project.activeNodeId ?? project.rootNodeId ?? ''
}

function compact(input: unknown): string {
  try {
    const s = JSON.stringify(input)
    return s.length > 160 ? s.slice(0, 160) + '…' : s
  } catch {
    return ''
  }
}

// ── Spawn-and-capture: run a canvas node, await it, return its full activity ──

interface Capture {
  ok: boolean
  node?: CanvasNode
  nodeId: string
  error?: string
  transcript: string
}

/**
 * Start a canvas run and resolve once it finishes, capturing the same activity
 * stream the renderer sees (status, tool calls/results, shell output, diff).
 * Runs are serial (one working tree), so exactly one is ever in flight here.
 *
 * The Walker's abort `signal` is threaded in so that cancelling the Walker
 * tears down the in-flight spawned run (via cancelRun) instead of orphaning it —
 * otherwise a long or non-terminating node would keep the Walker busy forever.
 */
function captureRun(
  start: () => Promise<{ runId: string; nodeId: string }>,
  signal: AbortSignal
): Promise<Capture> {
  return new Promise<Capture>((resolveP, rejectP) => {
    const lines: string[] = []
    const buffer: RunEvent[] = []
    let targetRunId: string | null = null
    let nodeId = ''
    let done = false
    let pendingCancel = false

    const push = (s: string) => {
      const t = s.replace(/\s+$/, '')
      if (t) lines.push(t.length > 800 ? t.slice(0, 800) + '…' : t)
    }

    // Cancel the underlying canvas run when the Walker is aborted.
    const onAbort = () => {
      pendingCancel = true
      if (targetRunId) cancelRun(targetRunId)
    }
    signal.addEventListener('abort', onAbort)

    const finish = (cap: Capture) => {
      if (done) return
      done = true
      signal.removeEventListener('abort', onAbort)
      unobserve()
      resolveP(cap)
    }

    const consume = (e: RunEvent) => {
      nodeId = e.nodeId
      switch (e.type) {
        case 'status':
          push(`· ${e.text}`)
          break
        case 'assistant':
          push(e.text)
          break
        case 'tool_call':
          push(`→ ${e.tool} ${compact(e.input)}`)
          break
        case 'tool_result':
          push(`  ${e.ok ? '✓' : '✗'} ${e.preview}`)
          break
        case 'output':
          push(e.text)
          break
        case 'done':
          finish({ ok: e.node.status !== 'error', node: e.node, nodeId: e.nodeId, transcript: lines.join('\n') })
          break
        case 'error':
          finish({ ok: false, nodeId: e.nodeId, error: e.message, transcript: lines.join('\n') })
          break
        // 'thinking' is intentionally omitted to keep the transcript focused.
      }
    }

    const handle = (e: RunEvent) => {
      if (targetRunId == null) {
        buffer.push(e)
        return
      }
      if (e.runId === targetRunId) consume(e)
    }

    const unobserve = observeRuns(handle)

    start()
      .then(({ runId, nodeId: nid }) => {
        targetRunId = runId
        nodeId = nid
        // Replay anything that arrived before we learned the runId.
        for (const e of buffer) if (e.runId === runId) consume(e)
        // If the Walker was aborted before the run id was known, tear it down now.
        if (!done && (pendingCancel || signal.aborted)) cancelRun(runId)
      })
      .catch((err) => {
        if (done) return
        done = true
        signal.removeEventListener('abort', onAbort)
        unobserve()
        rejectP(err)
      })
  })
}

function describeOutcome(cap: Capture): { ok: boolean; content: string } {
  const node = cap.node
  const parts: string[] = []
  parts.push(`Node ${cap.nodeId}${node ? ` "${node.title}"` : ''} — ${node?.status ?? 'error'}`)
  if (node?.resultState) parts.push(`result-state: ${node.resultState} (${node.resultStateKind})`)
  if (node?.diffStat)
    parts.push(
      `diff: ${node.diffStat.filesChanged} file(s) +${node.diffStat.insertions}/-${node.diffStat.deletions}`
    )
  if (node?.summary) parts.push(`summary: ${node.summary}`)
  if (node?.instructions)
    parts.push(
      `instructions set (every agentic descendant of this node will now follow them):\n${node.instructions}`
    )
  if (cap.error) parts.push(`error: ${cap.error}`)
  const tail = cap.transcript.length > 6000 ? '…' + cap.transcript.slice(-6000) : cap.transcript
  return {
    ok: cap.ok,
    content: `${parts.join('\n')}\n--- activity ---\n${tail || '(no activity captured)'}`
  }
}

// ── Walker tools ─────────────────────────────────────────────────────────────

const getCanvasTool: ToolDef = {
  name: 'get_canvas',
  description:
    'Get the canvas graph: every node with its id, title, kind, parent, status, inferred result-state, change summary and diff stats. Call this to understand the picture before deciding what to spawn next. If the user has COLLAPSED a node, only that node\'s subtree is shown plus a single "Collapsed" stub (id "__collapsed__") standing in for the hidden nodes — read its activity to see inside.',
  schema: { type: 'object', properties: {} }
}

const readNodeTool: ToolDef = {
  name: 'read_node',
  description:
    'Read one node in detail: its prompt/command, status, result-state, SUMMARY, error and diff stats. This summary is your FIRST reference for what a node did — prefer it. Only call read_node_activity if the summary is insufficient. Use the node id from get_canvas.',
  schema: {
    type: 'object',
    properties: { node: { type: 'string', description: 'The node id.' } },
    required: ['node']
  }
}

const readNodeDiffTool: ToolDef = {
  name: 'read_node_diff',
  description:
    "Read the actual code diff a node produced versus its parent (unified git diff). Use this to inspect exactly what an agentic step changed.",
  schema: {
    type: 'object',
    properties: { node: { type: 'string', description: 'The node id.' } },
    required: ['node']
  }
}

const readNodeActivityTool: ToolDef = {
  name: 'read_node_activity',
  description:
    "Read a node's FULL activity log from its last run — the agent's streamed thinking, every tool call + result, and command stdout/stderr. This is persisted, so it works for OLD nodes even across app restarts. ALWAYS prefer the `summary` from read_node first; only reach for this heavier log when the summary doesn't explain WHAT a node did or WHY it failed. Special case: reading the \"__collapsed__\" stub instead lists the hidden (collapsed) nodes and their connections so you can then read any by id.",
  schema: {
    type: 'object',
    properties: { node: { type: 'string', description: 'The node id.' } },
    required: ['node']
  }
}

/** Render a node's persisted RunEvents as a compact, readable transcript. */
function formatActivity(events: RunEvent[]): string {
  const compact = (input: unknown): string => {
    if (input == null) return ''
    if (typeof input === 'object') {
      const o = input as Record<string, unknown>
      return String(o.command ?? o.query ?? o.path ?? JSON.stringify(o)).slice(0, 200)
    }
    return String(input).slice(0, 200)
  }
  const lines: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'status': lines.push(`· ${e.text}`); break
      case 'thinking': lines.push(`[thinking] ${e.text.trim()}`); break
      case 'assistant': lines.push(e.text.trim()); break
      case 'tool_call': lines.push(`→ ${e.tool}(${compact(e.input)})`); break
      case 'tool_result': lines.push(`  ${e.ok ? '✓' : '✗'} ${e.preview}`); break
      case 'output': lines.push(`[${e.stream}] ${e.text.trimEnd()}`); break
      case 'error': lines.push(`ERROR: ${e.message}`); break
      case 'done': lines.push(`✓ done: ${e.node.summary ?? ''}`); break
    }
  }
  return lines.filter((l) => l.trim()).join('\n')
}

const spawnAgenticTool: ToolDef = {
  name: 'spawn_agentic_node',
  description:
    'Spawn an AGENTIC child node: run a persona on a SHORT, focused task against a parent node\'s codebase state. Personas are meant for small, well-scoped units of work — keep the prompt tight and split big work across several nodes. BLOCKS until the persona finishes, then returns its activity, change summary and diff. The new node becomes the active state, so further branches from it continue from its result.',
  schema: {
    type: 'object',
    properties: {
      parent: {
        type: 'string',
        description: 'Parent node id to branch from. Choose deliberately (see how_to choose a parent in the system prompt) — never guess. Defaults to the currently active node.'
      },
      persona: { type: 'string', description: 'Persona name or id to run (see list_personas). Must be an existing persona — ask_caretaker to create one if none fits.' },
      prompt: { type: 'string', description: 'The short, specific task for the persona.' }
    },
    required: ['persona', 'prompt']
  }
}

const spawnProcessTool: ToolDef = {
  name: 'spawn_process_node',
  description:
    'Start a DETERMINISTIC child node from a REUSABLE process (see list_processes), supplying any required inputs. This is the ONLY way you run deterministic work — there is no one-off command tool, so every deterministic step uses a saved, reusable process (visible in the Processes tab). Returns IMMEDIATELY with the node id while it runs in the background — monitor with check_node_progress, abort with stop_node, or await_node for the result. If no existing process fits, ask_caretaker to create one first (it gets saved to the Processes tab), then run it here.',
  schema: {
    type: 'object',
    properties: {
      parent: { type: 'string', description: 'Parent node id. Choose deliberately. Defaults to the active node.' },
      process: { type: 'string', description: 'Process name or id.' },
      inputs: {
        type: 'object',
        description: 'Map of input name → value for the process placeholders.',
        additionalProperties: { type: 'string' }
      }
    },
    required: ['process']
  }
}

const checkProgressTool: ToolDef = {
  name: 'check_node_progress',
  description:
    'Read the live output (tail) and current status of a deterministic node — works WHILE it is still running, so you can judge whether a build/test/install is going correctly before it finishes. Returns the last part of its output plus whether it is still running.',
  schema: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'The deterministic node id.' },
      tail: { type: 'number', description: 'How many characters of trailing output to return (default 4000).' }
    },
    required: ['node']
  }
}

const stopNodeTool: ToolDef = {
  name: 'stop_node',
  description:
    'Abort a running deterministic node mid-run (e.g. a build that is clearly failing, a hung install, an infinite loop). The node is recorded as a stopped/error attempt; branch a fresh attempt from its parent.',
  schema: {
    type: 'object',
    properties: { node: { type: 'string', description: 'The running deterministic node id.' } },
    required: ['node']
  }
}

const awaitNodeTool: ToolDef = {
  name: 'await_node',
  description:
    'Block until a deterministic node finishes, then return its final status, inferred result-state and output tail. Use this once you have decided to let a step run to completion.',
  schema: {
    type: 'object',
    properties: { node: { type: 'string', description: 'The deterministic node id to wait for.' } },
    required: ['node']
  }
}

const listPersonasTool: ToolDef = {
  name: 'list_personas',
  description: 'List the agent personas available to spawn (id, name, role, permissions, model).',
  schema: { type: 'object', properties: {} }
}

const listProcessesTool: ToolDef = {
  name: 'list_processes',
  description: 'List the reusable deterministic processes available to spawn (id, name, command, inputs).',
  schema: { type: 'object', properties: {} }
}

const askCaretakerTool: ToolDef = {
  name: 'ask_caretaker',
  description:
    "Ask the Care Taker to create or adjust capabilities you are missing — a new agent persona, or a new REUSABLE deterministic process (a named, parameterized command with result rules). The Care Taker saves it to the project so it persists and can be reused later. Describe exactly what you need (command, inputs, what counts as success/failure). ALWAYS also pass `successCriteria`: the explicit, checkable conditions the node must meet — the Care Taker tests the node against THESE same criteria (in a Park it iterates until they pass) so the node it returns satisfies what you actually need. After it confirms, call list_personas / list_processes to get the new item.",
  schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Plain-language request for the Care Taker.' },
      successCriteria: {
        type: 'string',
        description:
          'The explicit, testable success criteria the created node must satisfy (e.g. "given a dir path as $XCOM_target, prints a JSON array of changed files to stdout; exits 0 on success"). The Care Taker tests the node against exactly these.'
      }
    },
    required: ['message']
  }
}

const deleteNodeTool: ToolDef = {
  name: 'delete_node',
  description:
    'Delete a node (and its descendants) from the MAIN canvas. Use the node id from get_canvas. The root node cannot be deleted.',
  schema: {
    type: 'object',
    properties: { node: { type: 'string', description: 'The node id to delete.' } },
    required: ['node']
  }
}

const listParksTool: ToolDef = {
  name: 'list_parks',
  description:
    'List the Parks (nested workflow canvases) in this project, with their ids, kind (trigger/schedule), schedule, workflow node count and last-run status.',
  schema: { type: 'object', properties: {} }
}

const createParkTool: ToolDef = {
  name: 'create_park',
  description:
    'Create a Park node on the main canvas from a parent node. A Park is a reusable workflow canvas the USER builds and runs. You can ONLY create it (empty, with a clear name describing its purpose) — you cannot add steps to it or run it. After creating one, tell the user the Park is ready and what it is for so they can build and run/schedule its workflow.',
  schema: {
    type: 'object',
    properties: {
      parent: { type: 'string', description: 'Main-canvas node id the Park branches from. Defaults to the active node.' },
      name: { type: 'string', description: 'A clear name describing the Park\'s purpose (e.g. "Nightly test suite").' },
      parkKind: { type: 'string', enum: ['trigger', 'schedule'], description: 'trigger = run on demand; schedule = cron.' }
    },
    required: ['name', 'parkKind']
  }
}

const WALKER_TOOLS = [
  getCanvasTool,
  readNodeTool,
  readNodeDiffTool,
  readNodeActivityTool,
  spawnAgenticTool,
  spawnProcessTool,
  checkProgressTool,
  stopNodeTool,
  awaitNodeTool,
  listPersonasTool,
  listProcessesTool,
  askCaretakerTool,
  deleteNodeTool,
  listParksTool,
  createParkTool
]

// ── Park-mode tools (active when the Walker is invoked inside an open Park) ────

const getWorkflowTool: ToolDef = {
  name: 'get_workflow',
  description:
    "Get the OPEN Park's workflow graph: every step with its id, parent, kind (agentic/deterministic), persona/process, prompt/inputs, and its result from the most recent run (status, result-state, summary, output tail). Call this first to see what the workflow already contains and how the last run went.",
  schema: { type: 'object', properties: {} }
}

/** Shared schema for an activation condition (the `activation` arg on step tools). */
const activationSchema = {
  type: 'object',
  description:
    "Optional branch condition gating this step. The step (and its subtree) runs ONLY when the condition holds against an upstream step's last-run result. Tune `value` across runs to branch correctly. Omit for an unconditional step.",
  properties: {
    source: { type: 'string', description: 'Upstream step id whose result is tested. Defaults to this step\'s parent.' },
    field: {
      type: 'string',
      enum: ['resultState', 'resultStateKind', 'outputValue', 'output', 'exitCode', 'status'],
      description: "Which part of the upstream step's result to test (resultStateKind is success/failure/neutral)."
    },
    op: {
      type: 'string',
      enum: ['eq', 'neq', 'contains', 'notContains', 'matches', 'gt', 'lt', 'gte', 'lte', 'truthy', 'falsy'],
      description: 'Comparison operator. gt/lt/gte/lte are numeric; matches is a regex; truthy/falsy ignore value.'
    },
    value: { type: 'string', description: 'The value to compare against (the tunable knob). Omit for truthy/falsy.' }
  },
  required: ['field', 'op']
} as const

const addAgenticStepTool: ToolDef = {
  name: 'add_agentic_step',
  description:
    "Add an AGENTIC step to the OPEN Park's workflow: a persona that runs a short, focused task when the workflow runs. Steps execute in order from the Start node; each step receives the OUTPUTS of its ancestors as input and reads the codebase frozen at park creation (read-only), writing any files into an isolated workspace. Every step must declare what it OUTPUTS. Choose the parent deliberately (defaults to the latest step). The step is NOT run now; build the whole workflow, then run_workflow.",
  schema: {
    type: 'object',
    properties: {
      parent: {
        type: 'string',
        description: 'Workflow step id to chain after. Defaults to the latest step (or Start if the workflow is empty).'
      },
      persona: { type: 'string', description: 'Persona name or id (see list_personas). ask_caretaker to create one if none fits.' },
      prompt: { type: 'string', description: 'The short, specific task for the persona at this step.' },
      output: { type: 'string', description: 'REQUIRED. Short description of what this step OUTPUTS (e.g. "list of failing test names"). Downstream steps and conditions consume it.' },
      title: { type: 'string', description: 'Optional short label for the step.' },
      activation: activationSchema
    },
    required: ['persona', 'prompt', 'output']
  }
}

const addProcessStepTool: ToolDef = {
  name: 'add_process_step',
  description:
    "Add a DETERMINISTIC step to the OPEN Park's workflow from a REUSABLE process (see list_processes), supplying any inputs. Deterministic work always uses a saved process — there is no one-off command; ask_caretaker to create a process if none fits. The step's OUTPUT is the command's stdout; conditions can also test its exitCode and resultState. Commands run in the workspace with the read-only codebase at ./codebase and $KENNEL_CODEBASE. Choose the parent deliberately (defaults to the latest step). The step is NOT run now.",
  schema: {
    type: 'object',
    properties: {
      parent: { type: 'string', description: 'Workflow step id to chain after. Defaults to the latest step (or Start).' },
      process: { type: 'string', description: 'Process name or id.' },
      inputs: {
        type: 'object',
        description: 'Map of input name → value for the process placeholders.',
        additionalProperties: { type: 'string' }
      },
      output: { type: 'string', description: 'Optional short description of what this step OUTPUTS (defaults to the process result).' },
      title: { type: 'string', description: 'Optional short label for the step.' },
      activation: activationSchema
    },
    required: ['process']
  }
}

const addReportStepTool: ToolDef = {
  name: 'add_report_step',
  description:
    "Add a REPORT step to the OPEN Park's workflow: it synthesizes a report of the whole run's results (all steps' outputs, failures, skipped branches) to communicate the outcome to the user. Place it at the END of a chain (default parent = latest step). The REPORT WRITER — how the run's data is processed into the report — is a Park capability you choose: a Park persona (agentic; defaults to the built-in 'Summarize Report' if you pass neither) OR a Park process (deterministic; the assembled results are fed to it as the `run_results` input). Pass at most one of `persona`/`process`.",
  schema: {
    type: 'object',
    properties: {
      parent: { type: 'string', description: 'Workflow step id to chain after. Defaults to the latest step.' },
      persona: { type: 'string', description: "Park persona that writes the report. Omit both this and `process` to use the built-in 'Summarize Report' persona." },
      process: { type: 'string', description: 'Park process that produces the report (reads the assembled results from $XCOM_run_results / {{run_results}}). Use instead of `persona`.' },
      prompt: { type: 'string', description: 'Optional focus/instructions for a persona-written report.' },
      title: { type: 'string', description: 'Optional short label for the step.' },
      activation: activationSchema
    }
  }
}

const setActivationTool: ToolDef = {
  name: 'set_activation_condition',
  description:
    "Set, change, or CLEAR the branch activation condition on an existing step. Use this to tune branching across runs — e.g. after a run, adjust the value that decides whether a branch fires. Pass `clear: true` to make the step unconditional.",
  schema: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'Workflow step id to update (from get_workflow).' },
      clear: { type: 'boolean', description: 'If true, remove the condition (step always runs).' },
      activation: activationSchema
    },
    required: ['node']
  }
}

const setInputBindingTool: ToolDef = {
  name: 'set_input_binding',
  description:
    "Wire one of a step's declared INPUTS (from its capability's I/O contract) to an upstream step's OUTPUT, so data flows between them via XCom at run time. See each step's ioContract (inputs/outputs) and outputs via get_workflow. Pass clear:true to remove a binding.",
  schema: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'The step whose input you are wiring.' },
      input: { type: 'string', description: "The input key, from this step's ioContract.inputs." },
      sourceNode: { type: 'string', description: 'The upstream step id that produces the value.' },
      sourceKey: { type: 'string', description: 'The upstream output key (from its ioContract.outputs). Defaults to "return_value".' },
      clear: { type: 'boolean', description: 'Remove the binding for this input.' }
    },
    required: ['node', 'input']
  }
}

const deleteStepTool: ToolDef = {
  name: 'delete_step',
  description:
    "Remove a step from the OPEN Park's workflow (its children re-parent to its parent). The Start step cannot be removed. Use a step id from get_workflow.",
  schema: {
    type: 'object',
    properties: { node: { type: 'string', description: 'Workflow step id to delete.' } },
    required: ['node']
  }
}

const cleanupWorkflowTool: ToolDef = {
  name: 'cleanup_workflow',
  description:
    "FINAL TIDY-UP before you conclude. Deletes Park personas and Park processes that are NOT referenced by any step in ANY of this project's Parks (the built-in 'Summarize Report' writer is always kept). It also returns the current steps with their last-run status so you can spot leftover/unnecessary steps — delete those yourself with delete_step (pass `deleteSteps` here to remove several at once). Call this once the workflow meets the objective, to leave a clean Park with no orphan capabilities or dead steps.",
  schema: {
    type: 'object',
    properties: {
      deleteSteps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: ids of workflow steps to delete as part of cleanup (e.g. dead/experimental steps). Children re-parent to the deleted step’s parent; the Start step is never removed.'
      }
    }
  }
}

const runWorkflowTool: ToolDef = {
  name: 'run_workflow',
  description:
    "Run the OPEN Park's ENTIRE workflow once in an isolated workspace, and return each step's result (status, parent, result-state, exit code, declared output tail) plus which branches activated and which steps FAILED. Your runs are TEMPORARY (throwaway) — for validating and tuning the workflow you are building; they never enter the Park's recorded history, but the per-step outputs/logs are kept until your NEXT run so you can inspect them. Blocks until the run finishes. Only ONE run may be in flight across the app.",
  schema: { type: 'object', properties: {} }
}

const setObjectiveTool: ToolDef = {
  name: 'set_objective',
  description:
    "Record the OPEN Park's OBJECTIVE — a single, concrete sentence describing what the finished workflow must accomplish (its definition of done). Call this FIRST, before building, so you and the user share a clear target. It is shown in the UI and kept stable as you iterate. Refine it only if the user changes the goal.",
  schema: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: "What the finished workflow must reliably do, in one concrete sentence." }
    },
    required: ['objective']
  }
}

const inspectStepTool: ToolDef = {
  name: 'inspect_step',
  description:
    "Deep-dive into ONE step's result from the most recent run: its FULL declared output and its complete activity log (agent messages + tool calls/results, or command stdout/stderr). Use this when a step failed or produced the wrong output and the run_workflow summary tail isn't enough to understand WHY. Pass a step id from get_workflow / run_workflow.",
  schema: {
    type: 'object',
    properties: { node: { type: 'string', description: 'Workflow step id to inspect.' } },
    required: ['node']
  }
}

const WALKER_PARK_TOOLS = [
  setObjectiveTool,
  getWorkflowTool,
  addAgenticStepTool,
  addProcessStepTool,
  addReportStepTool,
  setActivationTool,
  setInputBindingTool,
  deleteStepTool,
  cleanupWorkflowTool,
  runWorkflowTool,
  inspectStepTool,
  listPersonasTool,
  listProcessesTool,
  askCaretakerTool
]

/** Parse + validate an `activation` tool arg into an ActivationCondition (or null). */
function parseActivation(raw: unknown): { ok: true; value: ActivationCondition } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'activation must be an object.' }
  const a = raw as Record<string, unknown>
  const fields = ['resultState', 'resultStateKind', 'outputValue', 'output', 'exitCode', 'status']
  const ops = ['eq', 'neq', 'contains', 'notContains', 'matches', 'gt', 'lt', 'gte', 'lte', 'truthy', 'falsy']
  const field = String(a.field ?? '')
  const op = String(a.op ?? '')
  if (!fields.includes(field)) return { ok: false, error: `activation.field must be one of: ${fields.join(', ')}.` }
  if (!ops.includes(op)) return { ok: false, error: `activation.op must be one of: ${ops.join(', ')}.` }
  const cond: ActivationCondition = { field: field as ActivationCondition['field'], op: op as ActivationCondition['op'] }
  if (a.source != null && String(a.source).trim()) cond.sourceNodeId = String(a.source)
  if (a.value != null) cond.value = String(a.value)
  return { ok: true, value: cond }
}

// ── Shared capability tools (available in both main-canvas and Park modes) ────

/**
 * list_personas / list_processes / ask_caretaker behave identically whether the
 * Walker is orchestrating the main canvas or building a Park's workflow, so both
 * executors delegate here. Returns null if `name` isn't one of these.
 */
async function runSharedTool(
  name: string,
  input: Record<string, any>,
  autonomy: WalkerAutonomy,
  signal: AbortSignal,
  /** When set (Park mode), the Care Taker is consulted in WORKFLOW mode for THIS Park. */
  parkId?: string
): Promise<{ ok: boolean; content: string } | null> {
  // Park mode lists the PARK pool; canvas mode lists the canvas pool.
  const want: 'canvas' | 'park' = parkId ? 'park' : 'canvas'

  if (name === 'list_personas') {
    const list = store
      .getState()
      .personas.filter((p) => inScopeForPark(p, want, parkId))
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        model: p.model,
        permissions: p.permissions,
        ioContract: p.ioContract
      }))
    return { ok: true, content: JSON.stringify(list, null, 2) }
  }

  if (name === 'list_processes') {
    const list = store
      .getState()
      .deterministicProcesses.filter((p) => inScopeForPark(p, want, parkId))
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        command: p.command,
        inputs: p.inputs,
        ioContract: p.ioContract
      }))
    return { ok: true, content: JSON.stringify(list, null, 2) }
  }

  if (name === 'ask_caretaker') {
    if (!MAY_ASK_CARETAKER[autonomy]) {
      return {
        ok: false,
        content:
          `At "${AUTONOMY_LABEL[autonomy]}" autonomy you may not create new capabilities. ` +
          `Work with the existing personas and processes, or recommend the user raise autonomy.`
      }
    }
    const message = String(input.message ?? '').trim()
    if (!message) return { ok: false, content: 'Describe what the Care Taker should create.' }
    const successCriteria = String(input.successCriteria ?? '').trim() || undefined
    // Don't race a user-driven Care Taker chat (both mutate the shared store).
    if (isCaretakerBusy()) {
      return {
        ok: false,
        content: 'The Care Taker is busy with another conversation right now — try again shortly.'
      }
    }
    try {
      sendWalkerEvent({ type: 'status', text: 'Consulting the Care Taker…' })
      const reply = await runCaretakerTurn({
        history: [],
        message,
        signal,
        restrictCoreMemory: true,
        // The criteria the Walker needs — the Care Taker tests the node against these.
        successCriteria,
        // In Park mode, the Care Taker builds & TESTS workflow nodes (XCom contracts).
        parkId
      })
      return { ok: true, content: `Care Taker: ${reply || '(done)'}` }
    } catch (err: any) {
      return { ok: false, content: `Care Taker failed: ${err?.message ?? String(err)}` }
    }
  }

  return null
}

// ── Executor ─────────────────────────────────────────────────────────────────

function makeExecutor(
  autonomy: WalkerAutonomy,
  signal: AbortSignal,
  state: { spawned: number; pendingDet: Set<string> }
) {
  const budget = NODE_BUDGET[autonomy]

  const checkBudget = (): { ok: boolean; content: string } | null => {
    if (state.spawned >= budget) {
      return {
        ok: false,
        content:
          `Node budget reached (${budget} nodes at "${AUTONOMY_LABEL[autonomy]}" autonomy). ` +
          `Do not spawn more — review the results you already have and conclude with your final answer.`
      }
    }
    return null
  }

  return async (name: string, rawInput: unknown): Promise<{ ok: boolean; content: string }> => {
    if (signal.aborted) return { ok: false, content: 'Walker was cancelled.' }
    const input = (rawInput ?? {}) as Record<string, any>
    const project = store.getProject()
    if (!project) return { ok: false, content: 'No project is open.' }

    if (name === 'get_canvas') {
      const active = project.activeNodeId
      const all = store.getNodes()
      // Respect a collapse: show only the focused node's subtree, plus one stub
      // standing in for everything hidden (ancestors + other branches).
      const focusId = project.focusedNodeId
      const visible = focusId && all.some((n) => n.id === focusId) ? subtreeIds(all, focusId) : null
      const shown = visible ? all.filter((n) => visible.has(n.id)) : all
      const nodes: Record<string, unknown>[] = shown.map((n) => ({
        id: n.id,
        // Reroute the focus node's parent to the collapsed stub so the graph reads.
        parentId: visible && n.id === focusId ? COLLAPSED_ID : n.parentId,
        title: n.title,
        kind: n.kind,
        status: n.status,
        resultState: n.resultState,
        resultStateKind: n.resultStateKind,
        persona: n.personaId ? store.getPersona(n.personaId)?.name : undefined,
        command: n.command,
        summary: n.summary,
        error: n.error,
        diff: n.diffStat,
        active: n.id === active
      }))
      if (visible) {
        const hiddenCount = all.length - visible.size
        nodes.push({
          id: COLLAPSED_ID,
          parentId: null,
          title: `Collapsed (${hiddenCount} hidden)`,
          kind: 'collapsed',
          summary: `${hiddenCount} node(s) — this subtree's ancestors and unrelated branches — are collapsed and hidden. Call read_node_activity with node id "${COLLAPSED_ID}" to list them and their connections, then read any by id.`
        })
      }
      return {
        ok: true,
        content: JSON.stringify(
          {
            activeNodeId: active,
            rootNodeId: project.rootNodeId,
            focusedNodeId: visible ? focusId : null,
            // The checked-out node is hidden inside the collapse — new spawns
            // default to the focused node so they stay visible (pass an explicit
            // `parent` to override).
            activeNodeHidden: visible ? !visible.has(active) : false,
            nodesSpawnedThisTask: state.spawned,
            nodeBudget: budget,
            nodes
          },
          null,
          2
        )
      }
    }

    if (name === 'read_node') {
      if (String(input.node ?? '') === COLLAPSED_ID) {
        const focusId = project.focusedNodeId
        const all = store.getNodes()
        if (!focusId || !all.some((n) => n.id === focusId)) {
          return { ok: true, content: 'Nothing is currently collapsed — the full canvas is shown by get_canvas.' }
        }
        const visible = subtreeIds(all, focusId)
        return {
          ok: true,
          content: JSON.stringify(
            {
              id: COLLAPSED_ID,
              kind: 'collapsed',
              focusNode: focusId,
              hiddenCount: all.filter((n) => !visible.has(n.id)).length,
              note: 'A collapsed region. Call read_node_activity on this id to list the hidden nodes and their connections.'
            },
            null,
            2
          )
        }
      }
      const n = store.getNode(String(input.node ?? ''))
      if (!n) return { ok: false, content: `No node with id "${input.node}".` }
      return {
        ok: true,
        content: JSON.stringify(
          {
            id: n.id,
            parentId: n.parentId,
            title: n.title,
            kind: n.kind,
            status: n.status,
            persona: n.personaId ? store.getPersona(n.personaId)?.name : undefined,
            prompt: n.prompt,
            command: n.command,
            inputs: n.inputs,
            resultState: n.resultState,
            resultStateKind: n.resultStateKind,
            summary: n.summary,
            error: n.error,
            diff: n.diffStat
          },
          null,
          2
        )
      }
    }

    if (name === 'read_node_diff') {
      const n = store.getNode(String(input.node ?? ''))
      if (!n) return { ok: false, content: `No node with id "${input.node}".` }
      if (!n.parentId) return { ok: true, content: '(root node — no diff)' }
      const parent = store.getNode(n.parentId)
      if (!parent) return { ok: true, content: '(parent not found)' }
      const text = await diff(project.path, parent.commit, n.commit)
      const clipped = text.length > 20_000 ? text.slice(0, 20_000) + '\n…[truncated]' : text
      return { ok: true, content: clipped || '(no changes)' }
    }

    if (name === 'read_node_activity') {
      // Reading the collapsed stub's activity is the "drill-in": it reveals the
      // hidden nodes' list + connections (ancestry) so the Walker can then read
      // any of them by id. (Hidden node data stays out of get_canvas until here.)
      if (String(input.node ?? '') === COLLAPSED_ID) {
        const focusId = project.focusedNodeId
        const all = store.getNodes()
        if (!focusId || !all.some((n) => n.id === focusId)) {
          return { ok: true, content: 'Nothing is currently collapsed — the full canvas is shown by get_canvas.' }
        }
        const visible = subtreeIds(all, focusId)
        const hidden = all
          .filter((n) => !visible.has(n.id))
          .map((n) => ({
            id: n.id,
            parentId: n.parentId,
            title: n.title,
            kind: n.kind,
            status: n.status,
            resultState: n.resultState,
            persona: n.personaId ? store.getPersona(n.personaId)?.name : undefined,
            summary: n.summary
          }))
        return {
          ok: true,
          content: JSON.stringify(
            {
              collapsed: true,
              focusNode: focusId ?? null,
              hiddenCount: hidden.length,
              note: 'These nodes (the focus subtree\'s ancestors + unrelated branches) are hidden from get_canvas. Read any by id with read_node / read_node_activity / read_node_diff.',
              nodes: hidden
            },
            null,
            2
          )
        }
      }
      const n = store.getNode(String(input.node ?? ''))
      if (!n) return { ok: false, content: `No node with id "${input.node}".` }
      const events = getNodeActivity(n.id)
      if (events.length === 0) {
        return {
          ok: true,
          content: `(no activity log recorded for "${n.title}" — its summary is: ${n.summary ?? '(none)'})`
        }
      }
      const body = formatActivity(events)
      // Keep the tail — failures and final results live at the end.
      const clipped =
        body.length > 16_000 ? '…[earlier activity truncated]\n' + body.slice(-16_000) : body
      return { ok: true, content: `summary: ${n.summary ?? '(none)'}\n--- full activity ---\n${clipped}` }
    }

    const shared = await runSharedTool(name, input, autonomy, signal)
    if (shared) return shared

    if (name === 'spawn_agentic_node') {
      const blocked = checkBudget()
      if (blocked) return blocked
      const persona = resolvePersona(input.persona, 'canvas')
      if (!persona)
        return { ok: false, content: `No persona matching "${input.persona}". Call list_personas.` }
      const prompt = String(input.prompt ?? '').trim()
      if (!prompt) return { ok: false, content: 'A non-empty prompt is required.' }
      const parentId = input.parent ? String(input.parent) : activeParentId()
      if (!store.getNode(parentId)) return { ok: false, content: `No parent node "${parentId}".` }

      try {
        const cap = await captureRun(
          () =>
            startAgenticRun({
              parentNodeId: parentId,
              personaId: persona.id,
              prompt,
              position: spawnPosition(parentId)
            }),
          signal
        )
        state.spawned += 1
        if (cap.nodeId) sendWalkerEvent({ type: 'spawned', nodeId: cap.nodeId })
        return describeOutcome(cap)
      } catch (err: any) {
        return { ok: false, content: `Could not start agentic node: ${err?.message ?? String(err)}` }
      }
    }

    if (name === 'spawn_process_node') {
      const blocked = checkBudget()
      if (blocked) return blocked
      const proc = resolveProcess(input.process)
      if (!proc)
        return { ok: false, content: `No process matching "${input.process}". Call list_processes (ask_caretaker to create one if none fits).` }
      const parentId = input.parent ? String(input.parent) : activeParentId()
      if (!store.getNode(parentId)) return { ok: false, content: `No parent node "${parentId}".` }
      const inputs: Record<string, string> = {}
      if (input.inputs && typeof input.inputs === 'object') {
        for (const [k, v] of Object.entries(input.inputs)) inputs[k] = String(v ?? '')
      }

      try {
        const { nodeId } = await startProcessRun({
          parentNodeId: parentId,
          processId: proc.id,
          inputs,
          position: spawnPosition(parentId)
        })
        state.spawned += 1
        state.pendingDet.add(nodeId) // so it's torn down if the Walker is cancelled
        sendWalkerEvent({ type: 'spawned', nodeId })
        return {
          ok: true,
          content:
            `Started deterministic node ${nodeId} (process "${proc.name}") in the background.\n` +
            `Watch it with check_node_progress, stop_node if it goes wrong, or await_node for the final result.`
        }
      } catch (err: any) {
        return { ok: false, content: `Could not start process node: ${err?.message ?? String(err)}` }
      }
    }

    if (name === 'check_node_progress') {
      const id = String(input.node ?? '')
      const n = store.getNode(id)
      if (!n) return { ok: false, content: `No node with id "${id}".` }
      const tailChars = Math.min(8000, Math.max(500, Number(input.tail) || 4000))
      const peek = peekNodeOutput(id, tailChars)
      if (!peek) {
        // Not a tracked deterministic node (e.g. agentic / already pruned).
        return { ok: true, content: describeNode(id, false) }
      }
      return {
        ok: true,
        content:
          `Node ${id} "${n.title}" — ${peek.running ? 'RUNNING' : `finished (${n.status})`}` +
          `${n.resultState ? ` · ${n.resultState}` : ''}\n` +
          `--- output (tail) ---\n${peek.output || '(no output yet)'}`
      }
    }

    if (name === 'stop_node') {
      const id = String(input.node ?? '')
      if (!store.getNode(id)) return { ok: false, content: `No node with id "${id}".` }
      const stopped = stopNode(id)
      if (!stopped) return { ok: false, content: `Node ${id} is not running — nothing to stop.` }
      sendWalkerEvent({ type: 'status', text: `Stopping node ${id}…` })
      await awaitNodeDone(id, signal)
      return { ok: true, content: `Stopped node ${id}.\n${describeNode(id, true)}` }
    }

    if (name === 'await_node') {
      const id = String(input.node ?? '')
      if (!store.getNode(id)) return { ok: false, content: `No node with id "${id}".` }
      await awaitNodeDone(id, signal)
      const n = store.getNode(id)
      return { ok: n?.status !== 'error', content: describeNode(id, true) }
    }

    if (name === 'delete_node') {
      const id = String(input.node ?? '')
      const n = store.getNode(id)
      if (!n) return { ok: false, content: `No node with id "${id}".` }
      if (n.kind === 'root') return { ok: false, content: 'The root node cannot be deleted.' }
      const ok = await deleteCanvasNode(id)
      sendState(store.getState())
      return ok
        ? { ok: true, content: `Deleted node "${n.title}" and its descendants.` }
        : { ok: false, content: 'Could not delete node.' }
    }

    if (name === 'list_parks') {
      const list = store.getParks().map((p) => ({
        id: p.id,
        name: p.name,
        parkKind: p.parkKind,
        cron: p.cron,
        scheduleEnabled: p.scheduleEnabled,
        steps: p.nodes.filter((n) => n.kind !== 'start').length,
        lastRun: p.lastRun?.status ?? null
      }))
      return { ok: true, content: JSON.stringify(list, null, 2) }
    }

    if (name === 'create_park') {
      const parentId = input.parent ? String(input.parent) : activeParentId()
      if (!store.getNode(parentId)) return { ok: false, content: `No parent node "${parentId}".` }
      const kind = input.parkKind === 'schedule' ? 'schedule' : 'trigger'
      try {
        const id = createPark({
          parentNodeId: parentId,
          name: String(input.name ?? 'Park'),
          parkKind: kind,
          position: spawnPosition(parentId)
        })
        sendState(store.getState())
        return {
          ok: true,
          content:
            `Created an empty ${kind} Park "${input.name}" (id ${id}) on the canvas. ` +
            `You cannot build or run it — tell the user the Park is ready and what it is for, ` +
            `so they can open it to build and ${kind === 'schedule' ? 'schedule' : 'run'} its workflow.`
        }
      } catch (err: any) {
        return { ok: false, content: err?.message ?? String(err) }
      }
    }

    // The Walker has no direct codebase access by design — it works only through
    // personas and deterministic nodes.
    return {
      ok: false,
      content:
        `Unknown tool "${name}". You have no direct access to the codebase and no one-off command tool — ` +
        `make progress through personas (spawn_agentic_node) and reusable deterministic processes (spawn_process_node; ask_caretaker to create a process if none fits).`
    }
  }
}

// ── Park-mode executor ───────────────────────────────────────────────────────

/**
 * Executor used when the Walker is invoked while a Park is open. Everything it
 * creates lands as a STEP in that Park's workflow (never the main canvas), and
 * it can run the whole workflow to iterate. Steps are authored, not run, until
 * run_workflow executes the Park as a batch against its base snapshot.
 */
function makeParkExecutor(
  autonomy: WalkerAutonomy,
  signal: AbortSignal,
  parkId: string,
  state: { added: number; runs: number }
) {
  const stepBudget = NODE_BUDGET[autonomy]
  const runBudget = WORKFLOW_RUN_BUDGET[autonomy]

  /** Default parent = the most recently added step (append to the end of the
   *  chain), else the Start node. `park.nodes` preserves insertion order — new
   *  steps are appended — so the last non-start node is the latest one; this
   *  avoids any createdAt tie ambiguity. */
  const defaultParent = (park: Park): string => {
    const steps = park.nodes.filter((n) => n.kind !== 'start')
    if (steps.length === 0) return park.nodes.find((n) => n.kind === 'start')?.id ?? ''
    return steps[steps.length - 1].id
  }

  /** Place a step below its parent, fanning siblings out (mirrors the renderer). */
  const wfPosition = (park: Park, parentId: string): { x: number; y: number } => {
    const parent = park.nodes.find((n) => n.id === parentId)
    const base = parent?.position ?? { x: 0, y: 0 }
    const siblings = park.nodes.filter((n) => n.parentId === parentId).length
    return { x: base.x - 120 + siblings * 280, y: base.y + 200 }
  }

  const addStep = (
    park: Park,
    input: Record<string, any>,
    build: (parentId: string) => Parameters<typeof addWorkflowNode>[1]
  ): { ok: boolean; content: string } => {
    if (state.added >= stepBudget) {
      return {
        ok: false,
        content:
          `Step budget reached (${stepBudget} steps at "${AUTONOMY_LABEL[autonomy]}" autonomy). ` +
          `Run the workflow you have built (run_workflow) and conclude, or recommend the user raise autonomy.`
      }
    }
    const parentId = input.parent ? String(input.parent) : defaultParent(park)
    if (!park.nodes.some((n) => n.id === parentId)) {
      return { ok: false, content: `No workflow step "${parentId}". Call get_workflow for valid step ids.` }
    }
    try {
      const id = addWorkflowNode(parkId, build(parentId))
      state.added += 1
      sendState(store.getState())
      return { ok: true, content: `Added step ${id} after ${parentId}.` }
    } catch (err: any) {
      return { ok: false, content: `Could not add step: ${err?.message ?? String(err)}` }
    }
  }

  return async (name: string, rawInput: unknown): Promise<{ ok: boolean; content: string }> => {
    if (signal.aborted) return { ok: false, content: 'Walker was cancelled.' }
    const input = (rawInput ?? {}) as Record<string, any>
    const project = store.getProject()
    if (!project) return { ok: false, content: 'No project is open.' }

    // Park mode: consult the Care Taker in WORKFLOW mode (tests nodes for THIS Park).
    const shared = await runSharedTool(name, input, autonomy, signal, parkId)
    if (shared) return shared

    const park = store.getPark(parkId)
    if (!park) {
      return { ok: false, content: 'The open Park is no longer available — it may have been deleted.' }
    }

    if (name === 'set_objective') {
      const objective = String(input.objective ?? '').trim()
      if (!objective) return { ok: false, content: 'Provide a concrete one-sentence objective.' }
      setParkObjective(parkId, objective)
      sendState(store.getState())
      return { ok: true, content: `Objective set: ${objective}` }
    }

    if (name === 'inspect_step') {
      const id = String(input.node ?? '')
      const target = park.nodes.find((n) => n.id === id)
      if (!target) return { ok: false, content: `No workflow step "${id}". Call get_workflow for step ids.` }
      if (target.kind === 'start') return { ok: false, content: 'The Start step has no result to inspect.' }
      if (!target.status || target.status === 'idle') {
        return { ok: false, content: `Step "${target.title}" has not run yet — run_workflow first.` }
      }
      const activated = (park.lastRun?.results ?? []).find((r) => r.nodeId === id)?.activated
      const detail = {
        id: target.id,
        title: target.title,
        kind: target.kind,
        status: target.status,
        activated,
        resultState: target.resultState,
        exitCode: target.exitCode,
        outputSpec: target.outputSpec,
        outputValue: target.outputValue ?? null,
        activityLog: target.output ?? null
      }
      return { ok: true, content: JSON.stringify(detail, null, 2) }
    }

    if (name === 'get_workflow') {
      const steps = park.nodes.map((n) => {
        // The XCom I/O contract a node inherits from its capability (persona/process).
        const contract =
          n.kind === 'agentic'
            ? n.personaId
              ? store.getPersona(n.personaId)?.ioContract
              : undefined
            : n.kind === 'deterministic'
              ? n.processId
                ? store.getProcess(n.processId)?.ioContract
                : undefined
              : undefined
        return {
          id: n.id,
          parentId: n.parentId,
          kind: n.kind,
          title: n.title,
          persona: n.personaId ? store.getPersona(n.personaId)?.name : undefined,
          process: n.processId ? store.getProcess(n.processId)?.name : undefined,
          prompt: n.prompt,
          command: n.command,
          inputs: n.inputs,
          outputSpec: n.outputSpec,
          // XCom: the node's declared I/O contract + how its inputs are wired + last outputs.
          ioContract: contract,
          inputBindings: n.inputBindings,
          activation: n.activation,
          status: n.status,
          resultState: n.resultState,
          exitCode: n.exitCode,
          summary: n.summary,
          outputs: n.outputs,
          outputValue: n.outputValue
            ? n.outputValue.length > 1200
              ? '…' + n.outputValue.slice(-1200)
              : n.outputValue
            : undefined
        }
      })
      return {
        ok: true,
        content: JSON.stringify(
          {
            park: {
              id: park.id,
              name: park.name,
              parkKind: park.parkKind,
              objective: park.objective ?? null,
              lastRun: park.lastRun
                ? { status: park.lastRun.status, mode: park.lastRun.mode, error: park.lastRun.error }
                : null,
              stepsAddedThisTask: state.added,
              stepBudget,
              workflowRunsThisTask: state.runs,
              runBudget
            },
            steps
          },
          null,
          2
        )
      }
    }

    // Validate an optional activation arg once for the add_* / set_* tools.
    let activation: ActivationCondition | undefined
    if (input.activation != null) {
      const parsed = parseActivation(input.activation)
      if (!parsed.ok) return { ok: false, content: parsed.error }
      activation = parsed.value
    }

    if (name === 'add_agentic_step') {
      const persona = resolvePersona(input.persona, 'park', parkId)
      if (!persona)
        return { ok: false, content: `No persona matching "${input.persona}". Call list_personas (ask_caretaker to create one if none fits).` }
      const prompt = String(input.prompt ?? '').trim()
      if (!prompt) return { ok: false, content: 'A non-empty prompt is required.' }
      const outputSpec = String(input.output ?? '').trim()
      if (!outputSpec)
        return { ok: false, content: 'Declare what this step OUTPUTS via the `output` field (e.g. "list of failing tests").' }
      const res = addStep(park, input, (parentId) => ({
        parentId,
        kind: 'agentic',
        title: String(input.title ?? '').trim() || persona.name,
        personaId: persona.id,
        prompt,
        outputSpec,
        activation,
        position: wfPosition(park, parentId)
      }))
      return res.ok
        ? { ok: true, content: `${res.content} — agentic, persona "${persona.name}", outputs "${outputSpec}".` }
        : res
    }

    if (name === 'add_process_step') {
      const proc = resolveProcess(input.process, 'park', parkId)
      if (!proc)
        return { ok: false, content: `No process matching "${input.process}". Call list_processes (ask_caretaker to create one if none fits).` }
      const inputs: Record<string, string> = {}
      if (input.inputs && typeof input.inputs === 'object') {
        for (const [k, v] of Object.entries(input.inputs)) inputs[k] = String(v ?? '')
      }
      const res = addStep(park, input, (parentId) => ({
        parentId,
        kind: 'deterministic',
        title: String(input.title ?? '').trim() || proc.name,
        processId: proc.id,
        inputs,
        outputSpec: String(input.output ?? '').trim() || undefined,
        activation,
        position: wfPosition(park, parentId)
      }))
      return res.ok
        ? { ok: true, content: `${res.content} — deterministic, process "${proc.name}".` }
        : res
    }

    if (name === 'add_report_step') {
      // The report writer is a chosen Park process, a chosen Park persona, or —
      // when neither is given — the built-in "Summarize Report" persona.
      let writer: { processId: string } | { personaId: string }
      let writerLabel: string
      if (input.process != null && String(input.process).trim()) {
        const proc = resolveProcess(input.process, 'park', parkId)
        if (!proc)
          return { ok: false, content: `No Park process matching "${input.process}". Ask the Care Taker to create one.` }
        writer = { processId: proc.id }
        writerLabel = `process "${proc.name}"`
      } else {
        const persona =
          (input.persona != null && String(input.persona).trim()
            ? resolvePersona(input.persona, 'park', parkId)
            : undefined) ?? store.getDefaultReportPersona()
        if (!persona)
          return {
            ok: false,
            content: input.persona
              ? `No Park persona matching "${input.persona}". Ask the Care Taker to create one.`
              : 'No built-in report persona available. Pass a `persona` or `process`.'
          }
        writer = { personaId: persona.id }
        writerLabel = `model "${persona.name}"`
      }
      const res = addStep(park, input, (parentId) => ({
        parentId,
        kind: 'report',
        title: String(input.title ?? '').trim() || 'Report',
        ...writer,
        prompt: String(input.prompt ?? '').trim() || undefined,
        outputSpec: 'Report of the whole run',
        activation,
        position: wfPosition(park, parentId)
      }))
      return res.ok ? { ok: true, content: `${res.content} — report (${writerLabel}).` } : res
    }

    if (name === 'set_activation_condition') {
      const id = String(input.node ?? '')
      const target = park.nodes.find((n) => n.id === id)
      if (!target) return { ok: false, content: `No workflow step "${id}". Call get_workflow.` }
      if (target.kind === 'start') return { ok: false, content: 'The Start step has no incoming condition.' }
      if (input.clear) {
        updateWorkflowNode(parkId, id, { activation: undefined })
        sendState(store.getState())
        return { ok: true, content: `Cleared the condition on "${target.title}" — it now always runs.` }
      }
      if (!activation)
        return { ok: false, content: 'Provide an `activation` object, or `clear: true` to remove the condition.' }
      updateWorkflowNode(parkId, id, { activation })
      sendState(store.getState())
      return {
        ok: true,
        content: `Set condition on "${target.title}": ${activation.field} ${activation.op}${activation.value != null ? ` "${activation.value}"` : ''}.`
      }
    }

    if (name === 'set_input_binding') {
      const id = String(input.node ?? '')
      const target = park.nodes.find((n) => n.id === id)
      if (!target) return { ok: false, content: `No workflow step "${id}". Call get_workflow.` }
      const key = String(input.input ?? '').trim()
      if (!key) return { ok: false, content: 'Provide the input key to wire (from the step ioContract.inputs).' }
      const bindings: Record<string, { sourceNodeId: string; key: string }> = { ...(target.inputBindings ?? {}) }
      if (input.clear) {
        delete bindings[key]
        updateWorkflowNode(parkId, id, { inputBindings: bindings })
        sendState(store.getState())
        return { ok: true, content: `Cleared input binding "${key}" on "${target.title}".` }
      }
      const src = String(input.sourceNode ?? '').trim()
      const srcNode = park.nodes.find((n) => n.id === src)
      if (!srcNode) return { ok: false, content: `No upstream step "${src}". Call get_workflow for step ids.` }
      if (src === id) return { ok: false, content: 'A step cannot bind an input to its own output.' }
      if (srcNode.kind === 'start') return { ok: false, content: 'The Start step produces no output to bind to.' }
      if (!isAncestorOf(park.nodes, src, id)) {
        return {
          ok: false,
          content: `"${srcNode.title}" is not an upstream step of "${target.title}". An input can only be wired to an ANCESTOR step (one that runs before it). Bind to a step on the path from Start to this one.`
        }
      }
      const srcKey = String(input.sourceKey ?? 'return_value').trim() || 'return_value'
      bindings[key] = { sourceNodeId: src, key: srcKey }
      updateWorkflowNode(parkId, id, { inputBindings: bindings })
      sendState(store.getState())
      return { ok: true, content: `Wired "${target.title}".${key} ← "${srcNode.title}".${srcKey} (XCom).` }
    }

    if (name === 'delete_step') {
      const id = String(input.node ?? '')
      const target = park.nodes.find((n) => n.id === id)
      if (!target) return { ok: false, content: `No workflow step "${id}". Call get_workflow.` }
      if (target.kind === 'start') return { ok: false, content: 'The Start step cannot be removed.' }
      deleteWorkflowNode(parkId, id)
      sendState(store.getState())
      return { ok: true, content: `Removed step "${target.title}" (${id}).` }
    }

    if (name === 'cleanup_workflow') {
      // 1. Optional explicit step deletions (the Walker's judgment of what's dead).
      const deletedSteps: string[] = []
      const ids = Array.isArray(input.deleteSteps) ? input.deleteSteps.map((x: unknown) => String(x)) : []
      for (const id of ids) {
        const t = park.nodes.find((n) => n.id === id)
        if (t && t.kind !== 'start') {
          deleteWorkflowNode(parkId, id)
          deletedSteps.push(`${t.title} (${id})`)
        }
      }
      // 2. Capability ids referenced by ANY step in ANY of this project's Parks —
      //    so we never delete a persona/process another Park still uses.
      const usedPersona = new Set<string>()
      const usedProcess = new Set<string>()
      for (const pk of store.getParks()) {
        for (const n of pk.nodes) {
          if (n.personaId) usedPersona.add(n.personaId)
          if (n.processId) usedProcess.add(n.processId)
        }
      }
      // 3. Delete unused Park-scoped capabilities (keep the built-in report writer).
      const deadPersonas = store
        .getProjectPersonas()
        .filter((p) => p.scope === 'park' && p.builtin !== 'summarize-report' && !usedPersona.has(p.id))
      const deadProcesses = store
        .getProcesses()
        .filter((p) => p.scope === 'park' && !usedProcess.has(p.id))
      // Remove from THIS project only (a shared persona may be used by another
      // project's Park) — same project-scoped removal the Care Taker's
      // delete_persona uses; the library definition is left for reuse.
      for (const p of deadPersonas) store.removePersonaFromProject(p.id)
      for (const p of deadProcesses) store.deleteProcess(p.id)
      sendState(store.getState())
      // 4. Report what was removed + the remaining steps (so the Walker can spot
      //    any further dead steps to delete on a follow-up call).
      const fresh = store.getPark(parkId)
      const remainingSteps = (fresh?.nodes ?? [])
        .filter((n) => n.kind !== 'start')
        .map((n) => ({ id: n.id, title: n.title, kind: n.kind, status: n.status ?? 'idle', resultState: n.resultState }))
      return {
        ok: true,
        content: JSON.stringify(
          {
            deletedSteps,
            deletedPersonas: deadPersonas.map((p) => p.name),
            deletedProcesses: deadProcesses.map((p) => p.name),
            remainingSteps
          },
          null,
          2
        )
      }
    }

    if (name === 'run_workflow') {
      if (state.runs >= runBudget) {
        return {
          ok: false,
          content:
            `Workflow-run budget reached (${runBudget} run(s) at "${AUTONOMY_LABEL[autonomy]}" autonomy). ` +
            `Review the last results and conclude, or recommend the user raise autonomy.`
        }
      }
      if (park.nodes.filter((n) => n.kind !== 'start').length === 0) {
        return { ok: false, content: 'The workflow has no steps yet — add steps before running it.' }
      }
      if (isBusy()) {
        return { ok: false, content: 'Another run is using the working tree right now — try again shortly.' }
      }
      // runWorkflow owns its own AbortController, so propagate a Walker cancel to
      // it — otherwise stopping the Walker would leave the workflow running and
      // the working tree wedged (isBusy stuck true).
      const onAbort = () => cancelWorkflow(parkId)
      signal.addEventListener('abort', onAbort)
      try {
        sendWalkerEvent({ type: 'status', text: `Running the "${park.name}" workflow…` })
        state.runs += 1
        // Walker's job is to BUILD the workflow — its runs are always temporary
        // (throwaway workspace, never entered into the Park's recorded history).
        await runWorkflow(parkId, 'walker', 'temporary')
      } catch (err: any) {
        if (signal.aborted) return { ok: false, content: 'Walker was cancelled.' }
        return { ok: false, content: `Could not run the workflow: ${err?.message ?? String(err)}` }
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
      const fresh = store.getPark(parkId)
      if (!fresh) return { ok: false, content: 'The Park vanished after the run.' }
      const activatedById = new Map((fresh.lastRun?.results ?? []).map((r) => [r.nodeId, r.activated]))
      const titleById = new Map(fresh.nodes.map((n) => [n.id, n.title]))
      const steps = fresh.nodes
        .filter((n) => n.kind !== 'start')
        .map((n) => ({
          id: n.id,
          title: n.title,
          kind: n.kind,
          // "which followed which" — the parent step this one ran after.
          after: n.parentId ? titleById.get(n.parentId) ?? n.parentId : 'Start',
          parentId: n.parentId,
          status: n.status,
          activated: activatedById.get(n.id),
          resultState: n.resultState,
          exitCode: n.exitCode,
          summary: n.summary,
          outputValue: n.outputValue
            ? n.outputValue.length > 1000
              ? '…' + n.outputValue.slice(-1000)
              : n.outputValue
            : undefined
        }))
      const failed = steps.filter((s) => s.status === 'error').map((s) => s.title)
      const skipped = steps.filter((s) => s.status === 'skipped').map((s) => s.title)
      const lr = fresh.lastRun
      return {
        ok: lr?.status !== 'error',
        content: JSON.stringify(
          {
            run: lr?.status ?? 'unknown',
            error: lr?.error,
            objective: fresh.objective ?? null,
            failedSteps: failed,
            skippedSteps: skipped,
            report: lr?.report,
            steps,
            hint: 'Use inspect_step(node) for a failed/wrong step to read its full output + activity log.'
          },
          null,
          2
        )
      }
    }

    return {
      ok: false,
      content:
        `Unknown tool "${name}" in Park mode. Build the OPEN Park's workflow with add_agentic_step / ` +
        `add_process_step, inspect it with get_workflow, and execute it with run_workflow.`
    }
  }
}

// ── System prompt ────────────────────────────────────────────────────────────

const WALKER_SYSTEM = (
  projectName: string,
  autonomy: WalkerAutonomy,
  budget: number
) =>
  `You are the Walker, an autonomous orchestrator inside Kennel — a node-based agentic IDE for the project "${projectName}".\n\n` +
  `YOU DO NOT TOUCH THE CODEBASE YOURSELF\n` +
  `- You have NO ability to read files, browse directories, search code, run one-off commands, or edit anything directly. You make ALL progress through two kinds of nodes: AGENTIC nodes (run a persona) and DETERMINISTIC nodes (run a saved, reusable process). This is deliberate — you orchestrate; the nodes do the work.\n\n` +
  `THE CANVAS IS A BRANCHING TREE — USE IT, DON'T JUST CHAIN\n` +
  `- The canvas is a TREE of nodes; every node is a concrete git-versioned state of the codebase, branched from its parent's EXACT state. A node can have MANY children — each is an independent line of work from the same starting point.\n` +
  `- Branching is your most powerful tool, not a fallback. The tree is a permanent RECORD of everything tried: which approaches were attempted, which failed, and which one finally worked — all visible to the user side by side. Default to BRANCHING from the right parent; only continue in a straight line when the next step genuinely builds on the previous result.\n` +
  `- To explore alternatives, spawn SEVERAL children from the same good parent (e.g. two different approaches), compare their results, and keep advancing from whichever won.\n\n` +
  `THE THREE PERSONA ROLES — USE ALL OF THEM, NOT JUST THE WORKER\n` +
  `- INSTRUCTOR (read-only): sets SHORT, PRECISE instructions for a body of work. Its output becomes the node's instructions, which are AUTOMATICALLY given to every agentic node BENEATH it. Spawn an Instructor at the head of a body of work to lock in the approach, conventions, and definition of done — then the Workers below inherit that direction. Spawn ANOTHER Instructor deeper in a branch to UPDATE the instructions for that sub-branch.\n` +
  `- ASK (read-only): investigates and answers questions about the codebase. Use it to understand the project, diagnose a failure, or decide between approaches BEFORE committing a Worker to changes. Reach for Ask whenever you are unsure — do not guess, and do not make a Worker burn effort rediscovering context.\n` +
  `- WORKER: implements changes (edits files, runs commands). The Worker is for DOING, once direction is set and context is known. Don't default to spawning Workers for everything.\n` +
  `- A good shape is often: Instructor (set direction) → Ask (investigate the unknowns) → Worker (implement) → deterministic node (verify), branching wherever there's a real choice or a failure to recover from.\n\n` +
  `PERSONAS ARE FOR SHORT TASKS\n` +
  `- Personas are best at small, well-scoped units of work. Decompose the task into small steps and run one persona per step — do not hand a persona a huge, open-ended job. Keep each prompt tight and concrete. Lean on the Instructor's instructions to carry shared context so each prompt can stay short.\n\n` +
  `NEVER GUESS — USE THE RIGHT, REUSABLE CAPABILITY\n` +
  `- Before doing work, call list_personas and list_processes. Decide whether the existing personas/processes can do each step.\n` +
  `- You have NO one-off command tool. EVERY deterministic step must run a REUSABLE process (spawn_process_node) — these are saved in the project's Processes tab and can be run again later.\n` +
  `- If NO existing persona or process fits a step, do NOT improvise. ask_caretaker to CREATE the right persona or deterministic process FIRST. The Care Taker saves the new process to the Processes tab (so it persists and is reusable); then call list_personas / list_processes again to get it, and use it. Set up the capabilities you need at the start of the work.\n\n` +
  `CHOOSING THE PARENT (do this deliberately, never at random)\n` +
  `- Each node branches from its parent's exact codebase state. Before spawning, look at get_canvas and pick the parent whose state this step should build on: the latest good node on the line you are advancing, or an earlier node when you want to try an ALTERNATIVE approach without inheriting a broken/unwanted state.\n` +
  `- Keep work under the relevant Instructor node so it inherits the right instructions.\n\n` +
  `ON FAILURE: BRANCH AND TRY AGAIN — DO NOT GIVE UP\n` +
  `- A failed or stopped node is information, not a dead end. NEVER conclude just because something failed while you still have node budget left.\n` +
  `- When a step fails: read its output to understand WHY (use Ask if the cause is unclear), then BRANCH a fresh attempt from the last GOOD parent (never pile onto the broken node) with a different approach informed by what you learned. Try genuinely different strategies across sibling branches.\n` +
  `- Spend your budget pushing through obstacles this way. Only stop early if the task is truly impossible with the available capabilities (and even then, say exactly what you tried and what blocked you).\n\n` +
  `RUNNING & SUPERVISING DETERMINISTIC NODES\n` +
  `- spawn_process_node runs a saved, reusable process and starts in the BACKGROUND, returning immediately with a node id. Only ONE node runs at a time, so you must finish (await or stop) the current one before starting another.\n` +
  `- While it runs, call check_node_progress to read the live output tail and judge whether it is going correctly. If it is clearly failing, hung, or doing the wrong thing, call stop_node to abort it mid-run, then branch a fresh attempt. Otherwise call await_node to wait for the final result.\n` +
  `- spawn_agentic_node BLOCKS until the persona finishes (personas are short) and returns its activity + diff.\n\n` +
  `PARKS\n` +
  `- create_park makes an empty reusable-workflow node for the USER. You CANNOT build its steps or run it. When a repeatable or scheduled multi-step job would help, create the Park with a clear name and TELL THE USER it is ready and what it is for — they build and run it.\n\n` +
  `HOW TO WORK\n` +
  `1. get_canvas, list_personas, list_processes — understand the picture and your toolkit. Ensure (via ask_caretaker) that the personas/processes you'll need exist before you start.\n` +
  `2. Set direction with an INSTRUCTOR node at the head of the work so everything beneath inherits it. Use ASK to clear up unknowns before committing Workers.\n` +
  `3. Decompose into short steps. For each: pick the parent deliberately (branch when there's a choice), pick the fitting persona/process, give a tight prompt or inputs.\n` +
  `4. Read each node's result (or supervise deterministic ones live) before deciding the next step. Carry concrete findings forward.\n` +
  `5. EXPERIMENT via branching, and on failure branch a fresh attempt from a good parent rather than giving up. Verify with deterministic nodes (build/test/lint) where possible.\n` +
  `6. When the task is achieved (ideally verified), STOP spawning and reply: what you did, which node holds the working result, what alternatives you tried (and why they lost), how it was verified, and any Park you created.\n\n` +
  `AUTONOMY: "${AUTONOMY_LABEL[autonomy]}". You may spawn at most ${budget} nodes for this task. ` +
  `${MAY_ASK_CARETAKER[autonomy] ? 'You may consult the Care Taker to create new capabilities.' : 'You may NOT create new capabilities — work only with what already exists.'} ` +
  `Spend the budget purposefully: it is there to be USED on investigation, branching, and recovering from failures — not hoarded. Aim each node well, but do not stop with budget remaining while the task is unmet and approaches are still untried. Always leave a little room to verify and conclude.\n` +
  `Only personas with explicit permission can edit files or run shell commands; pick personas whose permissions fit the step. Be concise in your messages to the user.`

const WALKER_PARK_SYSTEM = (
  projectName: string,
  park: Park,
  autonomy: WalkerAutonomy,
  stepBudget: number,
  runBudget: number
) =>
  `You are the Walker in WORKFLOW-BUILDER mode — a DISTINCT role from the main-canvas Walker. You operate INSIDE an open Park (a reusable workflow canvas) in Kennel, a node-based agentic IDE for the project "${projectName}". You do NOT spawn or touch main-canvas nodes here; everything you create is a STEP in THIS Park's workflow, separate from the canvas and from every other Park.\n\n` +
  `THE OPEN PARK: "${park.name}" — a ${park.parkKind === 'schedule' ? 'SCHEDULED (cron)' : 'on-demand TRIGGER'} workflow.\n` +
  (park.objective
    ? `CURRENT OBJECTIVE (your definition of done): ${park.objective}\nKeep working until the workflow reliably fulfills this. Refine it with set_objective only if the user changes the goal.\n\n`
    : `NO OBJECTIVE SET YET. Your FIRST action must be set_objective: distill the user's request into ONE concrete sentence describing what the finished workflow must reliably do. This is your definition of done; you build and iterate until it is met.\n\n`) +
  `Right now you are BUILDING, RUNNING, and ITERATING on THIS Park's workflow until it fulfills the objective. Every step you create lands in THIS Park's workflow.\n\n` +
  `THE WORKFLOW MODEL\n` +
  `- A Park workflow is a graph of steps rooted at a Start node. When the Park runs, it runs the steps in order from Start; each step receives the OUTPUTS of its ancestors as its input.\n` +
  `- A step is AGENTIC (a persona runs a focused task), DETERMINISTIC (a saved process runs, recording a result-state, exit code, and stdout), or a REPORT (synthesizes a report of the whole run for the user). A REPORT's writer — how the run data is turned into the report — is itself a Park capability you choose: a Park persona (agentic; defaults to the built-in "Summarize Report" persona) or a Park process (deterministic). So you or the user can fully control how the report is produced.\n` +
  `- EVERY step PRODUCES AN OUTPUT and you DECLARE what that output is when you add it (the \`output\` field). A declared, meaningful output is what makes the step usable downstream — keep outputs concrete (e.g. "JSON list of changed files", "PASS/FAIL", "the migration SQL").\n` +
  `- FILE ISOLATION: the codebase is FROZEN at park creation and is READ-ONLY (mounted at ./codebase and $KENNEL_CODEBASE). Steps run scripts/tests against it but write their OWN files into an isolated, per-run workspace — never the real project. Files made in a run are visible to later steps in the SAME run and are discarded between runs.\n` +
  `- IMPORTANT: unlike the main canvas, steps do NOT run as you add them. You author the workflow first, then run it as a batch with run_workflow.\n\n` +
  `BRANCHING WITH ACTIVATION CONDITIONS\n` +
  `- A step can carry an ACTIVATION CONDITION (the \`activation\` arg) that gates its incoming edge: the step (and everything below it) runs ONLY when the condition holds against an upstream step's result — e.g. field=resultStateKind op=eq value=failure to run a recovery branch only when a check failed. Steps without a condition always run.\n` +
  `- Give a parent MULTIPLE children with DIFFERENT conditions to branch the workflow (e.g. one path when tests pass, another when they fail). This is how a Park makes real decisions.\n` +
  `- TUNE conditions across runs: after a run, look at which branches \`activated\`, then use set_activation_condition to adjust the \`value\` (or field/op) until the workflow branches correctly. Finding the right condition values by iterating is a core part of your job.\n\n` +
  `NEVER GUESS — ASK THE CARE TAKER FOR TESTED NODES\n` +
  `- Call list_personas and list_processes first. Deterministic work ALWAYS uses a saved process — there is no one-off command. If no existing persona/process fits a step, ask_caretaker to CREATE it. ALWAYS give the Care Taker explicit SUCCESS CRITERIA (the \`successCriteria\` arg) — the exact, checkable conditions the node must meet — so it tests the node against the SAME bar you need, not a looser one of its own. In a Park the Care Taker is a WORKFLOW specialist: it builds the capability, defines its XCom I/O CONTRACT (named inputs + outputs, each with a format + example), and ACTUALLY TESTS the node against your criteria — iterating until it passes. Its reply tells you the node's exact inputs/outputs so you know how to use it.\n\n` +
  `WIRING DATA BETWEEN NODES (XCom)\n` +
  `- Each node has an I/O contract (see ioContract in get_workflow): named INPUTS it needs and named OUTPUTS it pushes. At run time a node PUSHES its outputs; downstream nodes PULL named inputs you have wired.\n` +
  `- After adding steps, use set_input_binding to wire each input of a step to the upstream step + output key that produces it (default output key is "return_value"). Check get_workflow to see each step's ioContract.inputs/outputs and last-run outputs. An unwired agentic input still receives loose ancestor context, but WIRE the inputs the contract declares so data flows reliably.\n\n` +
  `YOUR RUNS ARE TEMPORARY (but inspectable until your next run)\n` +
  `- Your run_workflow runs are throwaway (for building/validating/tuning) and never enter the Park's recorded history. The user chooses temporary-vs-recorded when THEY run the finished Park.\n` +
  `- After a run, every step keeps its full output and activity log until your NEXT run. run_workflow returns a summary (status, parent, result-state, exit code, a short output tail, and which branches activated/failed); when that summary is not enough to understand a failure or a wrong output, call inspect_step(node) to read that step's COMPLETE declared output and activity log. Diagnose before you change anything.\n\n` +
  `YOUR JOB — DEFINE, BUILD, RUN, DIAGNOSE, ITERATE until the OBJECTIVE is met\n` +
  `1. set_objective FIRST (unless one is already set above). get_workflow to see what the Park already contains and how its last run went. list_personas / list_processes; ask_caretaker to create anything missing FIRST.\n` +
  `2. Build the workflow: add_agentic_step / add_process_step (declaring each step's output), chaining after the right parent. Add activation conditions to branch. End with add_report_step when the user will want a readable summary — it defaults to the built-in "Summarize Report" persona, but pass a `+ '`persona`' + ` or `+ '`process`' + ` to control how the report is written. Use delete_step to remove a wrong step.\n` +
  `3. run_workflow to execute the whole Park. Read the result: which steps ran, which followed which, which FAILED or were skipped, and each step's declared output.\n` +
  `4. DIAGNOSE failures with inspect_step before fixing. Then fix the workflow (adjust steps, tune conditions with set_activation_condition) and run again. Repeat until the workflow reliably fulfills the OBJECTIVE.\n` +
  `5. CLEAN UP before concluding: once the objective is met, remove dead/experimental steps with delete_step, then call cleanup_workflow — it deletes Park personas and Park processes no step uses any longer (the built-in report writer is kept) and reports the remaining steps. Leave a tidy Park with no orphan capabilities or dead steps. THEN stop and tell the user the Park is built, that it meets the objective, and how the last run went.\n\n` +
  `AUTONOMY: "${AUTONOMY_LABEL[autonomy]}". You may add at most ${stepBudget} steps and run the workflow at most ${runBudget} time(s) this task. ` +
  `${MAY_ASK_CARETAKER[autonomy] ? 'You may consult the Care Taker to create new capabilities.' : 'You may NOT create new capabilities — work only with existing personas/processes.'} ` +
  `Be concise in your messages to the user.`

// ── Entry point ──────────────────────────────────────────────────────────────

export async function runWalker(payload: {
  chatId: string
  message: string
  autonomy: WalkerAutonomy
  /** When set (and the Park exists), the Walker builds & runs THIS Park's
   *  workflow instead of spawning nodes on the main canvas. */
  parkId?: string
}): Promise<void> {
  if (controller) throw new Error('The Walker is busy with another task.')
  const config = store.getWalker()
  if (!config) throw new Error('The Walker has no provider configured yet.')
  const provider = store.getProvider(config.providerId)
  if (!provider) throw new Error('The Walker’s provider was not found.')
  const project = store.getProject()
  if (!project) throw new Error('Open a project before running the Walker.')
  const apiKey = store.getApiKey(config.providerId) ?? ''
  const vertexAdc =
    provider.kind === 'google-vertex' && Boolean(provider.project) && Boolean(provider.location)
  // Copilot is keyless (its own OAuth, checked at run time via assertCopilotReady).
  const keyless = provider.kind === 'openai-compatible' || provider.kind === 'copilot' || vertexAdc
  if (!keyless && !apiKey) {
    throw new Error(`No API key set for provider "${provider.name}".`)
  }

  const chat = store.getChat('walker', payload.chatId)
  if (!chat) throw new Error('Conversation not found.')

  // Park mode: when invoked from an open Park, the Walker builds & runs THAT
  // Park's workflow. If a parkId was given but the Park is gone, REFUSE rather
  // than silently dropping to canvas mode (which would spawn main-canvas nodes).
  const park = payload.parkId ? store.getPark(payload.parkId) : undefined
  if (payload.parkId && !park) {
    throw new Error('The Park you were building is no longer available — reopen a Park to continue.')
  }

  const autonomy: WalkerAutonomy = payload.autonomy ?? 'medium'
  // Persist the chosen autonomy as the default for next time and onto this chat,
  // and broadcast so the renderer's copy of state stays in sync.
  store.setWalker({ ...config, autonomy })
  store.setChatAutonomy(payload.chatId, autonomy)

  // The conversation so far is the history; then record the new user message so
  // it persists and shows immediately, even if the modal is closed mid-run.
  const history: WalkerMessage[] = chat.messages.map((m) => ({ role: m.role, content: m.content }))
  store.appendChatMessage('walker', payload.chatId, { role: 'user', content: payload.message })
  // Expose the in-flight conversation so a freshly-loaded renderer can rebind to it.
  store.setRunningChat('walker', payload.chatId)
  sendState(store.getState())

  controller = new AbortController()
  const signal = controller.signal
  sendWalkerEvent({ type: 'start', chatId: payload.chatId })

  const budget = NODE_BUDGET[autonomy]

  // Main-canvas state (deterministic spawns to tear down on cancel) — unused in
  // Park mode, where nothing runs in the background.
  const canvasState = { spawned: 0, pendingDet: new Set<string>() }
  const execute = park
    ? makeParkExecutor(autonomy, signal, park.id, { added: 0, runs: 0 })
    : makeExecutor(autonomy, signal, canvasState)
  const tools = park ? WALKER_PARK_TOOLS : WALKER_TOOLS
  const systemPrompt = park
    ? WALKER_PARK_SYSTEM(project.name, park, autonomy, budget, WORKFLOW_RUN_BUDGET[autonomy])
    : WALKER_SYSTEM(project.name, autonomy, budget)

  try {
    const result = await runWithProvider(provider.kind, {
      apiKey,
      baseUrl: provider.baseUrl,
      model: config.model,
      systemPrompt,
      userPrompt: payload.message,
      history,
      effort: 'high',
      // Orchestration needs many more round-trips than a single persona run.
      maxIterations: 40 + budget * 6,
      // The Walker orchestrates only — no direct codebase tools.
      tools,
      execute,
      emit: (ev) => {
        if (ev.type === 'thinking') sendWalkerEvent({ type: 'thinking', text: ev.text })
        else if (ev.type === 'assistant') sendWalkerEvent({ type: 'assistant', text: ev.text })
        else if (ev.type === 'status') sendWalkerEvent({ type: 'status', text: ev.text })
        else if (ev.type === 'tool_call')
          sendWalkerEvent({ type: 'tool_call', tool: ev.tool, input: ev.input, callId: ev.callId })
        else if (ev.type === 'tool_result')
          sendWalkerEvent({ type: 'tool_result', callId: ev.callId, ok: ev.ok, preview: ev.preview })
      },
      signal: controller.signal,
      vertex: provider.kind === 'google-vertex',
      project: provider.project,
      location: provider.location,
      // Copilot: expose the Walker's orchestration tools as custom SDK tools and
      // disable Copilot's native coding tools — it orchestrates, never edits code.
      cwd: project.path,
      exposeKennelTools: true
    })
    // Clear the live stream first (done event), THEN surface the persisted reply
    // via state — avoids a one-frame double-render of the final message.
    sendWalkerEvent({ type: 'done', text: result.finalText })
    store.appendChatMessage('walker', payload.chatId, {
      role: 'assistant',
      content: result.finalText || 'Done.'
    })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    // Only a real cancellation (the AbortController is the authoritative source)
    // leaves the transcript as-is; any genuine failure is recorded so the user
    // never sees a dangling, unanswered turn.
    sendWalkerEvent({ type: 'error', message: msg })
    if (!signal.aborted) {
      store.appendChatMessage('walker', payload.chatId, { role: 'assistant', content: `⚠️ ${msg}` })
    }
  } finally {
    // Tear down any deterministic node still running in the background so a
    // cancelled or concluded Walker never orphans a process (e.g. a dev server)
    // or leaves the working tree wedged with isBusy() stuck true. stopNode is a
    // no-op for already-finished nodes. (Empty in Park mode — nothing runs in the
    // background there; a cancelled workflow run is torn down by runWorkflow.)
    for (const nodeId of canvasState.pendingDet) stopNode(nodeId)
    controller = null
    store.setRunningChat('walker', null)
    sendState(store.getState())
  }
}
