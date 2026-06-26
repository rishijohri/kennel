import { randomUUID } from 'node:crypto'
import type {
  AgentPersona,
  CaretakerMessage,
  DeterministicInput,
  DeterministicProcess,
  Effort,
  IoContract,
  ResultStateRule,
  XcomField
} from '@shared/types'
import { parkCapVisible } from '@shared/park-scope'
import { store } from '../services/store'
import { sendCaretakerEvent, sendState } from '../services/broadcast'
import { buildToolset, executeTool, type ToolContext, type ToolDef } from './tools'
import { runWithProvider } from './provider-runner'
import { runWorkflowNodeIsolated } from './workflow-runner'
import type { AgentStreamEvent } from './provider-types'

const COLORS = ['#7c6cff', '#4fd6a8', '#ffb454', '#ff6b8b', '#56b6ff', '#c678dd', '#98c379']
let colorCursor = 0
const nextColor = () => COLORS[colorCursor++ % COLORS.length]

let controller: AbortController | null = null
// Count of in-flight Care Taker turns, including those started on the Walker's
// behalf via ask_caretaker (which calls runCaretakerTurn directly). Every turn
// drives the same store-mutating meta-tools, so they must be serialized.
let activeTurns = 0

export function cancelCaretaker(): void {
  controller?.abort()
}

/**
 * True while ANY Care Taker turn is running — a user chat turn (controller set)
 * or a Walker `ask_caretaker` consult (activeTurns > 0). Used to reject a second
 * concurrent turn so two loops can't race the shared persona/process store.
 */
export function isCaretakerBusy(): boolean {
  return controller !== null || activeTurns > 0
}

// ── Coercion + lookup helpers ───────────────────────────────────────────────

function coerceInputs(raw: any): DeterministicInput[] {
  return Array.isArray(raw)
    ? raw.map((i: any) => ({
        name: String(i.name),
        description: i.description ? String(i.description) : undefined,
        required: Boolean(i.required),
        default: i.default != null ? String(i.default) : undefined
      }))
    : []
}

function coerceRules(raw: any): ResultStateRule[] {
  return Array.isArray(raw)
    ? raw.map((r: any) => ({
        state: String(r.state),
        kind: r.kind ?? 'neutral',
        when: r.when,
        exitCode: typeof r.exitCode === 'number' ? r.exitCode : undefined,
        pattern: r.pattern != null ? String(r.pattern) : undefined
      }))
    : []
}

/** Resolve a persona by id or (case-insensitive) name. */
function findPersona(target: string) {
  const t = target.trim().toLowerCase()
  return store.getState().personas.find((p) => p.id === target || p.name.toLowerCase() === t)
}

/** Resolve a deterministic process by id or (case-insensitive) name. */
function findProcess(target: string) {
  const t = target.trim().toLowerCase()
  return store
    .getState()
    .deterministicProcesses.find((p) => p.id === target || p.name.toLowerCase() === t)
}

// ── Care Taker meta-tools ───────────────────────────────────────────────────

const createPersonaTool: ToolDef = {
  name: 'create_persona',
  description:
    'Create a new agent persona the user can run on the canvas. Give it a clear name, a focused system prompt, and the minimum permissions it needs.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      role: { type: 'string', description: 'Short one-line tagline.' },
      emoji: { type: 'string', description: 'A single emoji avatar.' },
      systemPrompt: { type: 'string', description: 'How the agent should behave.' },
      model: { type: 'string', description: 'Optional model id; defaults to the provider default.' },
      canEditFiles: { type: 'boolean' },
      canRunBash: { type: 'boolean' },
      canEditCoreMemory: { type: 'boolean' },
      canSearchWeb: { type: 'boolean', description: 'Allow the built-in web search tool.' },
      canUseMcp: { type: 'boolean', description: 'Allow tools from configured MCP servers.' },
      effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] }
    },
    required: ['name', 'systemPrompt']
  }
}

const createProcessTool: ToolDef = {
  name: 'create_deterministic_process',
  description:
    'Create a reusable deterministic process: a parameterized shell command with typed inputs and rules that map the result (exit code / output) to a named state. Use {{inputName}} placeholders inside the command for inputs.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      emoji: { type: 'string' },
      command: { type: 'string', description: 'Shell command; use {{name}} placeholders for inputs.' },
      inputs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            required: { type: 'boolean' },
            default: { type: 'string' }
          },
          required: ['name']
        }
      },
      resultRules: {
        type: 'array',
        description: 'Evaluated in order; first match wins.',
        items: {
          type: 'object',
          properties: {
            state: { type: 'string', description: 'State label, e.g. "passing", "needs-deps".' },
            kind: { type: 'string', enum: ['success', 'failure', 'neutral'] },
            when: {
              type: 'string',
              enum: [
                'exit-zero',
                'exit-nonzero',
                'exit-code',
                'output-contains',
                'output-matches',
                'spawn-error',
                'default'
              ]
            },
            exitCode: { type: 'number' },
            pattern: { type: 'string', description: 'Substring or regex for output-* rules.' }
          },
          required: ['state', 'kind', 'when']
        }
      }
    },
    required: ['name', 'command']
  }
}

const updatePersonaTool: ToolDef = {
  name: 'update_persona',
  description:
    'Update an existing agent persona. Identify it with "target" (its current name or id). Only the fields you include are changed; omit the rest. Call list_personas first to see exact names/ids.',
  schema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Current name or id of the persona to update.' },
      name: { type: 'string', description: 'New name (optional).' },
      role: { type: 'string' },
      emoji: { type: 'string' },
      systemPrompt: { type: 'string' },
      model: { type: 'string' },
      canEditFiles: { type: 'boolean' },
      canRunBash: { type: 'boolean' },
      canEditCoreMemory: { type: 'boolean' },
      canSearchWeb: { type: 'boolean' },
      canUseMcp: { type: 'boolean' },
      effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] }
    },
    required: ['target']
  }
}

const deletePersonaTool: ToolDef = {
  name: 'delete_persona',
  description: 'Delete an agent persona, identified by its name or id.',
  schema: {
    type: 'object',
    properties: { target: { type: 'string', description: 'Name or id of the persona to delete.' } },
    required: ['target']
  }
}

const updateProcessTool: ToolDef = {
  name: 'update_deterministic_process',
  description:
    'Update an existing deterministic process. Identify it with "target" (its current name or id). Only the fields you include are changed; inputs and resultRules, if given, REPLACE the existing arrays. Call list_deterministic_processes first to see exact names/ids.',
  schema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Current name or id of the process to update.' },
      name: { type: 'string' },
      description: { type: 'string' },
      emoji: { type: 'string' },
      command: { type: 'string', description: 'Shell command; use {{name}} placeholders for inputs.' },
      // Reuse the same input/rule schemas as create (REPLACE the arrays if provided).
      inputs: (createProcessTool.schema as any).properties.inputs,
      resultRules: (createProcessTool.schema as any).properties.resultRules
    },
    required: ['target']
  }
}

const deleteProcessTool: ToolDef = {
  name: 'delete_deterministic_process',
  description: 'Delete a deterministic process, identified by its name or id.',
  schema: {
    type: 'object',
    properties: { target: { type: 'string', description: 'Name or id of the process to delete.' } },
    required: ['target']
  }
}

const listPersonasTool: ToolDef = {
  name: 'list_personas',
  description: 'List the existing agent personas (with ids and full config) so you can update, delete, or avoid duplicating them.',
  schema: { type: 'object', properties: {} }
}

const listProcessesTool: ToolDef = {
  name: 'list_deterministic_processes',
  description: 'List the existing deterministic processes (with ids and full config) so you can update, delete, or avoid duplicating them.',
  schema: { type: 'object', properties: {} }
}

const META_TOOLS = [
  createPersonaTool,
  updatePersonaTool,
  deletePersonaTool,
  createProcessTool,
  updateProcessTool,
  deleteProcessTool,
  listPersonasTool,
  listProcessesTool
]

// ── Park-mode tools: I/O contracts + node testing (XCom) ────────────────────

function coerceFields(raw: any): XcomField[] {
  return Array.isArray(raw)
    ? raw
        .map((f: any) => ({
          key: String(f.key ?? f.name ?? '').trim(),
          format: String(f.format ?? 'string'),
          example: f.example != null ? String(f.example) : undefined,
          description: f.description != null ? String(f.description) : undefined,
          required: f.required != null ? Boolean(f.required) : undefined
        }))
        .filter((f) => f.key)
    : []
}

function coerceSample(raw: any): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) out[k] = String(v ?? '')
  return Object.keys(out).length ? out : undefined
}

const fieldSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The XCom key / input name (e.g. "changed_files").' },
      format: { type: 'string', description: 'How the value is shaped, e.g. "JSON: string[]", "PASS|FAIL".' },
      example: { type: 'string', description: 'A concrete example value.' },
      description: { type: 'string' },
      required: { type: 'boolean', description: 'Inputs only: whether the node needs this input.' }
    },
    required: ['key', 'format']
  }
} as const

const defineIoContractTool: ToolDef = {
  name: 'define_io_contract',
  description:
    "Define (or replace) a workflow capability's XCom I/O contract: the named INPUTS it pulls from upstream nodes and the named OUTPUTS it pushes downstream, each with a format and example. Attach it to a persona (agentic node) or deterministic process you created. Defining a contract resets its tested flag — re-run test_node afterwards. Provide a `sample` (input key → value) the node can be tested with.",
  schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['persona', 'process'], description: 'Which capability this contract is for.' },
      target: { type: 'string', description: 'Name or id of the persona/process.' },
      inputs: fieldSchema,
      outputs: fieldSchema,
      sample: {
        type: 'object',
        description: 'Sample input values (key → value) to test the node with.',
        additionalProperties: { type: 'string' }
      }
    },
    required: ['kind', 'target', 'outputs']
  }
}

const testNodeTool: ToolDef = {
  name: 'test_node',
  description:
    "RUN a capability as a workflow node in a fresh ISOLATED workspace (against the open Park's frozen codebase) using sample inputs, and return its actual status, declared outputs (XCom keys), and full activity log. This is a REAL run (real LLM call for agentic, real shell for deterministic). Use it to verify the node works and produces the outputs its contract promises. If it fails or the output is wrong, fix the persona/process/contract and test again — iterate until it passes.",
  schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['agentic', 'deterministic'] },
      target: { type: 'string', description: 'Name or id of the persona (agentic) or process (deterministic).' },
      prompt: { type: 'string', description: 'Agentic only: the task this node performs (what the workflow step would ask it to do).' },
      sampleInputs: {
        type: 'object',
        description: 'Input values keyed by input name (defaults to the contract sample).',
        additionalProperties: { type: 'string' }
      }
    },
    required: ['kind', 'target']
  }
}

const markNodeTestedTool: ToolDef = {
  name: 'mark_node_tested',
  description:
    "Mark a capability's I/O contract as TESTED — call this ONLY after a test_node run passed and the outputs matched the contract. Records a short note of how it was verified, shown in the UI and to the Walker.",
  schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['persona', 'process'] },
      target: { type: 'string', description: 'Name or id of the persona/process.' },
      notes: { type: 'string', description: 'One line: how it was verified (e.g. "ran on sample, produced valid JSON outputs").' }
    },
    required: ['kind', 'target']
  }
}

const PARK_META_TOOLS = [
  createPersonaTool,
  updatePersonaTool,
  createProcessTool,
  updateProcessTool,
  listPersonasTool,
  listProcessesTool,
  defineIoContractTool,
  testNodeTool,
  markNodeTestedTool
]

// ── Executor for the meta-tools (delegates read tools to the codebase executor) ──

/** A persona/process belongs to the given context. Park items are 'park'-scoped. */
function inScope(itemScope: 'canvas' | 'park' | undefined, want: 'canvas' | 'park'): boolean {
  return want === 'park' ? itemScope === 'park' : itemScope !== 'park'
}

function makeExecutor(
  readCtx: ToolContext,
  providerId: string,
  defaultModel: string,
  opts: { restrictCoreMemory?: boolean; scope?: 'canvas' | 'park'; parkId?: string } = {}
) {
  // When invoked on the Walker's behalf, the Care Taker may not grant the
  // protected core-memory permission (KENNEL.md / .kennel) — that stays a
  // deliberate, user-made choice rather than something an autonomous agent
  // can hand itself mid-task.
  const allowCoreMemory = (requested: boolean) => (opts.restrictCoreMemory ? false : requested)
  // Park Care Taker manages a SEPARATE pool of park-scoped personas/processes;
  // the canvas Care Taker manages canvas-scoped ones. They never see each other.
  const scope: 'canvas' | 'park' = opts.scope === 'park' ? 'park' : 'canvas'
  // The Park a created park-cap belongs to (for per-project cross-park isolation).
  const ownerParkId = scope === 'park' ? opts.parkId : undefined
  // In park mode, honor the project's cross-park sharing setting; canvas is unaffected.
  const scopeVisible = (item: { scope?: 'canvas' | 'park'; ownerParkId?: string; builtin?: string }) =>
    scope === 'park'
      ? parkCapVisible(item, opts.parkId, store.getProject()?.shareParkCapabilities !== false)
      : inScope(item.scope, 'canvas')
  const findPersonaScoped = (t: string) => {
    const p = findPersona(t)
    return p && scopeVisible(p) ? p : undefined
  }
  const findProcessScoped = (t: string) => {
    const p = findProcess(t)
    return p && scopeVisible(p) ? p : undefined
  }

  return async (name: string, rawInput: unknown): Promise<{ ok: boolean; content: string }> => {
    const input = (rawInput ?? {}) as Record<string, any>

    if (name === 'create_persona') {
      const persona: AgentPersona = {
        id: randomUUID(),
        name: String(input.name ?? 'Agent'),
        role: input.role ? String(input.role) : undefined,
        emoji: String(input.emoji ?? '🤖'),
        color: nextColor(),
        providerId,
        model: input.model ? String(input.model) : defaultModel,
        systemPrompt: String(input.systemPrompt ?? ''),
        permissions: {
          canEditFiles: Boolean(input.canEditFiles),
          canRunBash: Boolean(input.canRunBash),
          canEditCoreMemory: allowCoreMemory(Boolean(input.canEditCoreMemory)),
          canSearchWeb: Boolean(input.canSearchWeb),
          canUseMcp: Boolean(input.canUseMcp)
        },
        effort: (input.effort as Effort) ?? 'high',
        scope: scope === 'park' ? 'park' : undefined,
        ownerParkId
      }
      store.upsertPersona(persona)
      sendState(store.getState())
      return { ok: true, content: `Created ${scope === 'park' ? 'Park ' : ''}persona "${persona.name}".` }
    }

    if (name === 'create_deterministic_process') {
      const proc: DeterministicProcess = {
        id: randomUUID(),
        name: String(input.name ?? 'Process'),
        emoji: String(input.emoji ?? '⚙️'),
        color: nextColor(),
        description: input.description ? String(input.description) : undefined,
        command: String(input.command ?? ''),
        inputs: coerceInputs(input.inputs),
        resultRules: coerceRules(input.resultRules),
        scope: scope === 'park' ? 'park' : undefined,
        ownerParkId,
        createdAt: Date.now()
      }
      store.upsertProcess(proc)
      sendState(store.getState())
      return { ok: true, content: `Created ${scope === 'park' ? 'Park ' : ''}deterministic process "${proc.name}".` }
    }

    if (name === 'update_persona') {
      const persona = findPersonaScoped(String(input.target ?? ''))
      if (!persona) return { ok: false, content: `No persona matching "${input.target}".` }
      const updated: AgentPersona = { ...persona, permissions: { ...persona.permissions } }
      if (input.name) updated.name = String(input.name)
      if (input.role !== undefined) updated.role = input.role ? String(input.role) : undefined
      if (input.emoji) updated.emoji = String(input.emoji)
      if (input.model) updated.model = String(input.model)
      if (input.systemPrompt !== undefined) updated.systemPrompt = String(input.systemPrompt)
      if (input.effort) updated.effort = input.effort as Effort
      if (input.canEditFiles !== undefined) updated.permissions.canEditFiles = Boolean(input.canEditFiles)
      if (input.canRunBash !== undefined) updated.permissions.canRunBash = Boolean(input.canRunBash)
      if (input.canEditCoreMemory !== undefined)
        updated.permissions.canEditCoreMemory = allowCoreMemory(Boolean(input.canEditCoreMemory))
      if (input.canSearchWeb !== undefined) updated.permissions.canSearchWeb = Boolean(input.canSearchWeb)
      if (input.canUseMcp !== undefined) updated.permissions.canUseMcp = Boolean(input.canUseMcp)
      store.upsertPersona(updated)
      sendState(store.getState())
      return { ok: true, content: `Updated persona "${updated.name}".` }
    }

    if (name === 'delete_persona') {
      const persona = findPersonaScoped(String(input.target ?? ''))
      if (!persona) return { ok: false, content: `No persona matching "${input.target}".` }
      // Remove from this project (the definition stays in the library for reuse).
      store.removePersonaFromProject(persona.id)
      sendState(store.getState())
      return { ok: true, content: `Removed persona "${persona.name}" from this project.` }
    }

    if (name === 'update_deterministic_process') {
      const proc = findProcessScoped(String(input.target ?? ''))
      if (!proc) return { ok: false, content: `No process matching "${input.target}".` }
      const updated: DeterministicProcess = { ...proc }
      if (input.name) updated.name = String(input.name)
      if (input.description !== undefined)
        updated.description = input.description ? String(input.description) : undefined
      if (input.emoji) updated.emoji = String(input.emoji)
      if (input.command) updated.command = String(input.command)
      if (Array.isArray(input.inputs)) updated.inputs = coerceInputs(input.inputs)
      if (Array.isArray(input.resultRules)) updated.resultRules = coerceRules(input.resultRules)
      store.upsertProcess(updated)
      sendState(store.getState())
      return { ok: true, content: `Updated deterministic process "${updated.name}".` }
    }

    if (name === 'delete_deterministic_process') {
      const proc = findProcessScoped(String(input.target ?? ''))
      if (!proc) return { ok: false, content: `No process matching "${input.target}".` }
      store.deleteProcess(proc.id)
      sendState(store.getState())
      return { ok: true, content: `Deleted deterministic process "${proc.name}".` }
    }

    if (name === 'list_personas') {
      const list = store
        .getState()
        .personas.filter((p) => scopeVisible(p))
        .map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          emoji: p.emoji,
          model: p.model,
          permissions: p.permissions,
          effort: p.effort,
          ioContract: p.ioContract,
          systemPrompt: p.systemPrompt
        }))
      return { ok: true, content: JSON.stringify(list, null, 2) }
    }

    if (name === 'list_deterministic_processes') {
      const list = store
        .getState()
        .deterministicProcesses.filter((p) => scopeVisible(p))
        .map((p) => ({
          id: p.id,
          name: p.name,
          emoji: p.emoji,
          description: p.description,
          command: p.command,
          inputs: p.inputs,
          ioContract: p.ioContract,
          resultRules: p.resultRules
        }))
      return { ok: true, content: JSON.stringify(list, null, 2) }
    }

    // Read-only codebase inspection (read_file / list_dir / search_code).
    return executeTool(name, rawInput, readCtx)
  }
}

/**
 * Executor for the PARK Care Taker: handles the I/O-contract + node-testing
 * tools, then delegates everything else (create/update persona/process, list,
 * read-only codebase) to the base executor. `parkId` scopes test runs to the
 * open Park's frozen codebase.
 */
function makeParkExecutor(
  readCtx: ToolContext,
  providerId: string,
  defaultModel: string,
  parkId: string,
  signal: AbortSignal,
  opts: { restrictCoreMemory?: boolean } = {}
) {
  const base = makeExecutor(readCtx, providerId, defaultModel, { ...opts, scope: 'park', parkId })

  // Park Care Taker only ever touches PARK-scoped capabilities VISIBLE in this
  // Park (honors the project's cross-park sharing setting).
  const visibleHere = (p: { scope?: 'canvas' | 'park'; ownerParkId?: string; builtin?: string }) =>
    parkCapVisible(p, parkId, store.getProject()?.shareParkCapabilities !== false)
  const resolveCap = (kind: string, target: string) => {
    if (kind === 'persona') {
      const p = findPersona(target)
      return p && visibleHere(p) ? p : undefined
    }
    if (kind === 'process') {
      const p = findProcess(target)
      return p && visibleHere(p) ? p : undefined
    }
    return undefined
  }

  return async (name: string, rawInput: unknown): Promise<{ ok: boolean; content: string }> => {
    const input = (rawInput ?? {}) as Record<string, any>

    if (name === 'define_io_contract') {
      const kind = String(input.kind ?? '')
      const cap = resolveCap(kind, String(input.target ?? ''))
      if (!cap) return { ok: false, content: `No ${kind} matching "${input.target}".` }
      const contract: IoContract = {
        inputs: coerceFields(input.inputs),
        outputs: coerceFields(input.outputs),
        sample: coerceSample(input.sample),
        tested: false
      }
      if (kind === 'persona') store.upsertPersona({ ...(cap as AgentPersona), ioContract: contract })
      else store.upsertProcess({ ...(cap as DeterministicProcess), ioContract: contract })
      sendState(store.getState())
      return {
        ok: true,
        content: `Set I/O contract on ${kind} "${(cap as any).name}": ${contract.inputs.length} input(s), ${contract.outputs.length} output(s). Now run test_node to verify it.`
      }
    }

    if (name === 'mark_node_tested') {
      const kind = String(input.kind ?? '')
      const cap = resolveCap(kind, String(input.target ?? ''))
      if (!cap) return { ok: false, content: `No ${kind} matching "${input.target}".` }
      const existing = (cap as any).ioContract as IoContract | undefined
      if (!existing) return { ok: false, content: 'Define the I/O contract first (define_io_contract).' }
      const updated: IoContract = { ...existing, tested: true, testNotes: input.notes ? String(input.notes) : undefined }
      if (kind === 'persona') store.upsertPersona({ ...(cap as AgentPersona), ioContract: updated })
      else store.upsertProcess({ ...(cap as DeterministicProcess), ioContract: updated })
      sendState(store.getState())
      return { ok: true, content: `Marked ${kind} "${(cap as any).name}" as tested.` }
    }

    if (name === 'test_node') {
      const kind = String(input.kind ?? '')
      if (kind === 'agentic') {
        const persona = resolveCap('persona', String(input.target ?? '')) as AgentPersona | undefined
        if (!persona) return { ok: false, content: `No Park persona matching "${input.target}".` }
        const sample = coerceSample(input.sampleInputs) ?? persona.ioContract?.sample
        const res = await runWorkflowNodeIsolated({
          parkId,
          kind: 'agentic',
          personaId: persona.id,
          prompt: String(input.prompt ?? '').trim() || persona.role || 'Perform your task.',
          inputs: sample,
          contract: persona.ioContract,
          signal
        })
        return { ok: res.status !== 'error', content: formatTestResult(res) }
      }
      if (kind === 'deterministic') {
        const proc = resolveCap('process', String(input.target ?? '')) as DeterministicProcess | undefined
        if (!proc) return { ok: false, content: `No Park process matching "${input.target}".` }
        const sample = coerceSample(input.sampleInputs) ?? proc.ioContract?.sample
        const res = await runWorkflowNodeIsolated({
          parkId,
          kind: 'deterministic',
          processId: proc.id,
          inputs: sample,
          contract: proc.ioContract,
          signal
        })
        return { ok: res.status !== 'error', content: formatTestResult(res) }
      }
      return { ok: false, content: 'test_node "kind" must be "agentic" or "deterministic".' }
    }

    return base(name, rawInput)
  }
}

/** Render an isolated test run for the Care Taker to inspect + decide on. */
function formatTestResult(res: Awaited<ReturnType<typeof runWorkflowNodeIsolated>>): string {
  const logTail = res.output ? (res.output.length > 4000 ? '…' + res.output.slice(-4000) : res.output) : ''
  return JSON.stringify(
    {
      status: res.status,
      resultState: res.resultState,
      exitCode: res.exitCode,
      outputs: res.outputs ?? null,
      outputValue: res.outputValue ? (res.outputValue.length > 1500 ? res.outputValue.slice(0, 1500) + '…' : res.outputValue) : null,
      error: res.error,
      activityLog: logTail
    },
    null,
    2
  )
}

const CARETAKER_SYSTEM = (projectName: string | null) =>
  `You are the Care Taker for a Kennel project${projectName ? ` ("${projectName}")` : ''}.\n` +
  `Kennel is a node-based agentic IDE. You manage the user's workspace by creating, updating, and deleting:\n` +
  `- Agent personas: focused agents with a clear system prompt and the minimum permissions they need (create_persona, update_persona, delete_persona).\n` +
  `- Deterministic processes: reusable, parameterized shell commands (validation scripts, setup/install scripts, formatters, tests) with typed {{inputs}} and result-state rules (create_deterministic_process, update_deterministic_process, delete_deterministic_process).\n` +
  `${projectName ? 'You may inspect the project read-only (read_file, list_dir, search_code) to design scripts that fit this codebase.\n' : ''}` +
  `IMPORTANT: When the user asks to change, fix, rename, tweak, or remove an EXISTING persona or process, UPDATE or DELETE it — do NOT create a near-duplicate. ` +
  `Always call list_personas / list_deterministic_processes first to get the exact name/id, then update_* (identify the item with "target"; include only the fields that change) or delete_*. ` +
  `When designing a deterministic process, prefer {{placeholders}} for anything that should vary, and define result rules so outcomes map to clear states (e.g. exit-zero → success, exit-nonzero → failed). ` +
  `Keep replies concise and tell the user exactly what you changed.`

const CARETAKER_PARK_SYSTEM = (projectName: string | null) =>
  `You are the Care Taker in WORKFLOW mode — a DISTINCT role from the main-canvas Care Taker. The Walker is building a Park workflow${projectName ? ` for the project "${projectName}"` : ''} and consults you to CREATE TESTED, WELL-SPECIFIED NODES it can wire together.\n\n` +
  `WHAT A NODE IS\n` +
  `- An AGENTIC node = a persona running a focused task. A DETERMINISTIC node = a saved process (a parameterized shell command with {{inputs}} and result rules). You create/update these reusable capabilities as usual.\n` +
  `- A node runs in an isolated workspace: the Park's codebase is mounted READ-ONLY at ./codebase (and $KENNEL_CODEBASE); created files go to the writable workspace.\n\n` +
  `XCom — THE INTER-NODE COMMUNICATION PROTOCOL (like Airflow)\n` +
  `- Nodes pass data by named XComs. A node PUSHES named OUTPUTS; downstream nodes PULL named INPUTS by key. An agentic node emits its outputs as a SINGLE JSON object (keys = the declared output keys) after its output marker; a deterministic node prints that JSON object to stdout (or a single value becomes the "return_value" output). Inputs are injected: agentic nodes receive them in the prompt; deterministic nodes get them as {{name}} placeholders and $XCOM_<name> env vars.\n` +
  `- So EVERY node needs a clear I/O CONTRACT: named inputs (with format + example) and named outputs (with format + example). This is what lets the Walker wire nodes correctly and know exactly how to use each one.\n\n` +
  `SUCCESS CRITERIA\n` +
  `- The Walker gives you explicit SUCCESS CRITERIA for the node (in the request). These ARE your definition of "passing" — the node must satisfy them, and you must TEST it against exactly these criteria, not a looser bar of your own. If no criteria were given, infer the strictest reasonable ones from the request and state them back.\n\n` +
  `YOUR LOOP FOR EACH NODE THE WALKER ASKS FOR — build, contract, TEST against the criteria, iterate\n` +
  `1. Create/update the persona (agentic) or deterministic process. Keep it focused.\n` +
  `2. define_io_contract: declare its named inputs + outputs (format + example each) and a realistic \`sample\` input that exercises the success criteria.\n` +
  `3. test_node: actually RUN it in isolation on the sample. Inspect the returned status + outputs + activity log, and JUDGE them against the success criteria.\n` +
  `4. If it failed, errored, or its result does not meet the SUCCESS CRITERIA (or the outputs don't match the contract), FIX it (update the persona/process, or adjust the contract/sample) and test_node AGAIN. ITERATE until it runs successfully AND meets every success criterion.\n` +
  `5. mark_node_tested once it passes the criteria (record how you verified in the notes).\n` +
  `6. Reply telling the Walker the node's name, what it does, and its EXACT inputs/outputs (keys + formats + examples), so the Walker knows how to wire it (which upstream output to bind to each input).\n\n` +
  `You may inspect the project read-only (read_file, list_dir, search_code). Be rigorous: a node is not done until test_node passes. Keep replies concise and concrete.`

/**
 * Run a single Care Taker turn and return its final text. Used both by the
 * chat-facing {@link runCaretaker} and by the Walker's `ask_caretaker` tool so
 * the Walker can have new personas / processes created mid-task and then use
 * them. The optional `emit` forwards streaming events to whoever drives it.
 */
export async function runCaretakerTurn(opts: {
  history: CaretakerMessage[]
  message: string
  signal: AbortSignal
  emit?: (e: AgentStreamEvent) => void
  /** When set (e.g. invoked by the Walker), the Care Taker may not grant the protected core-memory permission. */
  restrictCoreMemory?: boolean
  /** Explicit success criteria the requested node must satisfy. The Care Taker
   *  tests the node against EXACTLY these (in a Park, iterating until they pass). */
  successCriteria?: string
  /** When set, the Care Taker works in WORKFLOW mode: builds & TESTS nodes with
   *  XCom I/O contracts for THIS Park (and tests run against its codebase). */
  parkId?: string
}): Promise<string> {
  const config = store.getCaretaker()
  if (!config) throw new Error('The Care Taker has no provider configured yet.')
  const provider = store.getProvider(config.providerId)
  if (!provider) throw new Error('The Care Taker’s provider was not found.')
  const apiKey = store.getApiKey(config.providerId) ?? ''
  const vertexAdc =
    provider.kind === 'google-vertex' && Boolean(provider.project) && Boolean(provider.location)
  if (!(provider.kind === 'openai-compatible' || vertexAdc) && !apiKey) {
    throw new Error(`No API key set for provider "${provider.name}".`)
  }

  const project = store.getProject()
  const readCtx: ToolContext = {
    cwd: project?.path ?? process.cwd(),
    permissions: { canEditFiles: false, canRunBash: false, canEditCoreMemory: false, canSearchWeb: false, canUseMcp: false },
    signal: opts.signal
  }
  // Park mode (invoked by the Walker inside an open Park) is a DISTINCT agent:
  // it builds & tests workflow nodes with XCom I/O contracts. If a parkId was
  // requested but the Park is gone, FAIL LOUDLY — never silently fall back to
  // canvas scope (that would create canvas-scoped capabilities invisible under
  // Park Processes and unresolvable by the Walker).
  if (opts.parkId && !store.getPark(opts.parkId)) {
    throw new Error('The Park to build for is no longer available — it may have been deleted or the project changed.')
  }
  const parkMode = Boolean(opts.parkId)
  const defaultModel = config.model || provider.defaultModel || ''
  const tools = [
    ...(parkMode ? PARK_META_TOOLS : META_TOOLS),
    ...(project ? buildToolset(readCtx.permissions) : [])
  ]
  const execute = parkMode
    ? makeParkExecutor(readCtx, config.providerId, defaultModel, opts.parkId!, opts.signal, {
        restrictCoreMemory: opts.restrictCoreMemory
      })
    : makeExecutor(readCtx, config.providerId, defaultModel, {
        restrictCoreMemory: opts.restrictCoreMemory,
        scope: 'canvas'
      })

  // Mark a turn in flight (serializes against any other Care Taker turn, incl.
  // a concurrent user chat while the Walker consults via ask_caretaker).
  activeTurns++
  try {
    const result = await runWithProvider(provider.kind, {
      apiKey,
      baseUrl: provider.baseUrl,
      model: config.model,
      systemPrompt: parkMode
        ? CARETAKER_PARK_SYSTEM(project?.name ?? null)
        : CARETAKER_SYSTEM(project?.name ?? null),
      userPrompt: opts.successCriteria
        ? `${opts.message}\n\nSUCCESS CRITERIA — the node MUST satisfy these, and you must TEST it against exactly these before reporting success:\n${opts.successCriteria}`
        : opts.message,
      history: opts.history,
      effort: 'high',
      tools,
      execute,
      emit: opts.emit ?? (() => {}),
      signal: opts.signal,
      vertex: provider.kind === 'google-vertex',
      project: provider.project,
      location: provider.location
    })
    return result.finalText
  } finally {
    activeTurns--
  }
}

export async function runCaretaker(payload: {
  chatId: string
  message: string
}): Promise<void> {
  if (isCaretakerBusy()) throw new Error('The Care Taker is busy. Try again in a moment.')
  const chat = store.getChat('caretaker', payload.chatId)
  if (!chat) throw new Error('Conversation not found.')

  // The conversation so far is the history; then record the new user message so
  // it persists and shows immediately, even if the modal is closed mid-run.
  const history: CaretakerMessage[] = chat.messages.map((m) => ({ role: m.role, content: m.content }))
  store.appendChatMessage('caretaker', payload.chatId, { role: 'user', content: payload.message })
  // Expose the in-flight conversation so a freshly-loaded renderer can rebind to it.
  store.setRunningChat('caretaker', payload.chatId)
  sendState(store.getState())

  controller = new AbortController()
  const signal = controller.signal
  sendCaretakerEvent({ type: 'start', chatId: payload.chatId })
  try {
    const finalText = await runCaretakerTurn({
      history,
      message: payload.message,
      signal,
      emit: (ev) => {
        if (ev.type === 'thinking') sendCaretakerEvent({ type: 'thinking', text: ev.text })
        else if (ev.type === 'assistant') sendCaretakerEvent({ type: 'assistant', text: ev.text })
        else if (ev.type === 'status') sendCaretakerEvent({ type: 'status', text: ev.text })
        else if (ev.type === 'tool_call')
          sendCaretakerEvent({ type: 'tool_call', tool: ev.tool, input: ev.input, callId: ev.callId })
        else if (ev.type === 'tool_result')
          sendCaretakerEvent({
            type: 'tool_result',
            callId: ev.callId,
            ok: ev.ok,
            preview: ev.preview
          })
      }
    })
    // Clear the live stream first (done event), THEN surface the persisted reply
    // via state — avoids a one-frame double-render of the final message.
    sendCaretakerEvent({ type: 'done', text: finalText })
    store.appendChatMessage('caretaker', payload.chatId, {
      role: 'assistant',
      content: finalText || 'Done.'
    })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    // Only a real cancellation (the AbortController is the authoritative source)
    // leaves the transcript as-is; any genuine failure is recorded so the user
    // never sees a dangling, unanswered turn.
    sendCaretakerEvent({ type: 'error', message: msg })
    if (!signal.aborted) {
      store.appendChatMessage('caretaker', payload.chatId, { role: 'assistant', content: `⚠️ ${msg}` })
    }
  } finally {
    controller = null
    store.setRunningChat('caretaker', null)
    sendState(store.getState())
  }
}
