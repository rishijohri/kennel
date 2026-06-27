import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type {
  AgentPersona,
  IoContract,
  NodeStatus,
  Park,
  WorkflowNode,
  WorkflowNodeResult,
  WorkflowRun,
  WorkflowRunMode,
  WorkflowRunTrigger
} from '@shared/types'
import { store } from '../services/store'
import { sendState } from '../services/broadcast'
import { evalActivation } from './workflow-conditions'
import {
  formatInputsBlock,
  formatOutputContract,
  resolveInputs,
  toOutputs
} from './workflow-xcom'
import { buildToolset, executeTool, type ToolContext } from './tools'
import { getMcpToolDefs } from '../services/mcp'
import { runWithProvider } from './provider-runner'
import { applyInputs, inferResult, type ExecutionResult } from './result-infer'
import { holdWorkingTree, isBusy, releaseWorkingTree } from './run-manager'
import {
  CODEBASE_MOUNT,
  createRunWorkspace,
  discardRun,
  teardownCodebase,
  type RunWorkspace
} from '../services/workflow-workspace'

/** The XCom I/O contract a node inherits from its capability (persona/process). */
function capabilityContract(node: WorkflowNode): IoContract | undefined {
  if (node.kind === 'agentic') return node.personaId ? store.getPersona(node.personaId)?.ioContract : undefined
  if (node.kind === 'deterministic') return node.processId ? store.getProcess(node.processId)?.ioContract : undefined
  return undefined
}

/** Default result rules for ad-hoc deterministic workflow steps. */
const DEFAULT_RULES = [
  { state: 'success', kind: 'success' as const, when: 'exit-zero' as const },
  { state: 'failed', kind: 'failure' as const, when: 'exit-nonzero' as const },
  { state: 'failed to start', kind: 'failure' as const, when: 'spawn-error' as const }
]

/** How many recorded runs a Park keeps before the oldest are pruned. */
const RUN_HISTORY_CAP = 25

/** Marker an agentic step ends with to delimit its declared OUTPUT. */
const OUTPUT_MARKER = '===OUTPUT==='

const controllers = new Map<string, AbortController>()

export function cancelWorkflow(parkId: string): void {
  controllers.get(parkId)?.abort()
}

function summarize(text: string, fallback: string): string {
  const first = text.split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
  const s = first || fallback
  return s.length > 140 ? s.slice(0, 140) + '…' : s
}

/** Pull the declared OUTPUT out of an agent's final text (after the last marker). */
function extractOutput(finalText: string): string {
  const idx = finalText.lastIndexOf(OUTPUT_MARKER)
  const body = idx >= 0 ? finalText.slice(idx + OUTPUT_MARKER.length) : finalText
  return body.trim()
}

/** BFS from the start node — parents before children (workflow is a tree). */
function executionOrder(nodes: WorkflowNode[]): WorkflowNode[] {
  const start = nodes.find((n) => n.kind === 'start')
  if (!start) return []
  const children = new Map<string, WorkflowNode[]>()
  for (const n of nodes) {
    if (n.parentId) {
      const a = children.get(n.parentId) ?? []
      a.push(n)
      children.set(n.parentId, a)
    }
  }
  for (const a of children.values()) a.sort((x, y) => x.createdAt - y.createdAt)
  const order: WorkflowNode[] = []
  const queue = [start.id]
  const seen = new Set([start.id])
  while (queue.length) {
    const id = queue.shift()!
    for (const k of children.get(id) ?? []) {
      if (!seen.has(k.id)) {
        seen.add(k.id)
        order.push(k)
        queue.push(k.id)
      }
    }
  }
  return order
}

/** Outputs of all transitive ancestors that ran, oldest first (declared output preferred). */
function ancestorContext(nodes: WorkflowNode[], nodeId: string): string {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const chain: WorkflowNode[] = []
  let cur = byId.get(nodeId)?.parentId ?? null
  while (cur) {
    const n = byId.get(cur)
    if (!n || n.kind === 'start') break
    chain.push(n)
    cur = n.parentId
  }
  chain.reverse()
  const ran = chain.filter((n) => n.status === 'done' || n.status === 'error')
  if (ran.length === 0) return ''
  const blocks = ran.map((n) => {
    const out = (n.outputValue || n.summary || n.output || '(no output)').toString().slice(0, 1800)
    const spec = n.outputSpec ? `\n_Produces: ${n.outputSpec}_` : ''
    return `### Step "${n.title}" (${n.resultState ?? n.status ?? 'done'})${spec}\n${out}`
  })
  return (
    `You are one step in a workflow. Here are the OUTPUTS of the previous steps, in order. ` +
    `Use them as your input:\n\n${blocks.join('\n\n')}\n\n— end of previous steps —\n\n`
  )
}

const WORKFLOW_AGENT_SYSTEM = (
  projectName: string,
  outputSpec: string | undefined,
  contract: IoContract | undefined
) => {
  const outDoc = formatOutputContract(contract)
  return (
    `You are an agent running as one step of a Park workflow inside Kennel for the project "${projectName}".\n` +
    `FILE MODEL — read this carefully:\n` +
    `- Your working directory is an isolated, writable WORKSPACE for this run. Files you create here are the workflow's output and are kept SEPARATE from the project's codebase.\n` +
    `- The project's codebase, frozen at the moment this Park was created, is mounted READ-ONLY at "./${CODEBASE_MOUNT}/" (also available via the $KENNEL_CODEBASE environment variable in run_bash). Read it and run its scripts/tests, but you CANNOT modify it — write any created files into the workspace.\n` +
    `- Earlier steps in THIS run share your workspace, so you can see files they produced; you never see files from other runs.\n` +
    `- Tool paths are relative to the workspace root (e.g. "out/report.json", or "${CODEBASE_MOUNT}/src/index.ts" to read the codebase).\n` +
    `Base your work on the INPUTS you are given (in the user message) and the codebase.\n` +
    (outputSpec
      ? `THIS STEP MUST PRODUCE THIS OUTPUT: ${outputSpec}\n`
      : `Produce a clear, concrete result for this step.\n`) +
    (outDoc
      ? `OUTPUT CONTRACT (XCom) — after the marker below, emit a SINGLE JSON object with EXACTLY these keys, so downstream steps can pull them:\n${outDoc}\n`
      : '') +
    `When finished, end your final message with a line containing exactly "${OUTPUT_MARKER}" followed by your step's OUTPUT — ` +
    (outDoc
      ? `the JSON object described above, and nothing after it.\n\n`
      : `the concrete value described above, and nothing after it. Downstream steps and branch conditions read everything after that marker.\n\n`)
  )
}

interface StepResult {
  status: NodeStatus
  output: string
  outputValue?: string
  /** Named XCom outputs this node pushed (key → value). */
  outputs?: Record<string, string>
  summary?: string
  resultState?: string
  resultStateKind?: 'success' | 'failure' | 'neutral'
  exitCode?: number | null
}

/** Resolve a persona + provider for an agentic/report step, or an error StepResult. */
function resolvePersonaProvider(
  personaId: string | undefined
): { persona: AgentPersona; provider: ReturnType<typeof store.getProvider>; apiKey: string } | StepResult {
  const persona = personaId ? store.getProjectPersonas().find((p) => p.id === personaId) : undefined
  if (!persona) {
    return {
      status: 'error',
      output: "This step's persona is no longer part of this project — reassign the step to a current persona."
    }
  }
  const provider = store.getProvider(persona.providerId)
  if (!provider) return { status: 'error', output: 'This persona has no provider configured.' }
  const apiKey = store.getApiKey(persona.providerId) ?? ''
  const vertexAdc =
    provider.kind === 'google-vertex' && Boolean(provider.project) && Boolean(provider.location)
  // Copilot is keyless (CLI OAuth); openai-compatible may be keyless too.
  const keyless =
    provider.kind === 'openai-compatible' || provider.kind === 'copilot' || vertexAdc
  if (!keyless && !apiKey) {
    return { status: 'error', output: `No API key set for provider "${provider.name}".` }
  }
  return { persona, provider, apiKey }
}

/** Tool context for a workflow step: writes go to the workspace, codebase is read-only. */
function workflowToolCtx(
  persona: AgentPersona,
  ws: RunWorkspace,
  signal: AbortSignal,
  cap: (t: string) => void
): ToolContext {
  return {
    cwd: ws.workspaceDir,
    permissions: persona.permissions,
    signal,
    onOutput: (_s, text) => cap(text),
    allowRoots: [ws.codebaseDir],
    readonlyRoots: [ws.codebaseDir],
    env: { KENNEL_CODEBASE: ws.codebaseDir, KENNEL_WORKSPACE: ws.workspaceDir }
  }
}

async function runAgenticStep(
  node: WorkflowNode,
  parkNodes: WorkflowNode[],
  ws: RunWorkspace,
  projectName: string,
  signal: AbortSignal,
  resolvedInputs: Record<string, string>,
  contract: IoContract | undefined,
  onProgress?: (text: string) => void
): Promise<StepResult> {
  const resolved = resolvePersonaProvider(node.personaId)
  if ('status' in resolved) return resolved
  const { persona, provider, apiKey } = resolved

  let out = ''
  let lastFlush = 0
  const cap = (t: string) => {
    out += t
    if (out.length > 40_000) out = out.slice(-40_000)
    // Throttle live-log updates so the inspector can follow along mid-run.
    if (onProgress) {
      const now = Date.now()
      if (now - lastFlush > 400) {
        lastFlush = now
        onProgress(out)
      }
    }
  }

  const toolCtx = workflowToolCtx(persona, ws, signal, cap)
  const tools = [
    ...buildToolset(persona.permissions),
    ...(persona.permissions.canUseMcp ? await getMcpToolDefs() : [])
  ]
  const execute = (name: string, input: unknown) => executeTool(name, input, toolCtx)
  // Structured XCom inputs (bound to upstream outputs) take precedence; the
  // ancestor context provides looser background for steps without a contract.
  const inputsBlock = formatInputsBlock(contract, resolvedInputs)
  const userPrompt =
    inputsBlock + (inputsBlock ? '' : ancestorContext(parkNodes, node.id)) + (node.prompt ?? node.title)

  try {
    const result = await runWithProvider(provider!.kind, {
      apiKey,
      baseUrl: provider!.baseUrl,
      model: persona.model,
      systemPrompt: WORKFLOW_AGENT_SYSTEM(projectName, node.outputSpec, contract) + persona.systemPrompt,
      userPrompt,
      effort: persona.effort,
      tools,
      execute,
      emit: (ev) => {
        if (ev.type === 'assistant') cap(ev.text)
        else if (ev.type === 'tool_call') cap(`\n→ ${ev.tool} ${JSON.stringify(ev.input).slice(0, 160)}\n`)
        else if (ev.type === 'tool_result') cap(`  ${ev.ok ? '✓' : '✗'} ${ev.preview}\n`)
        else if (ev.type === 'status') cap(`· ${ev.text}\n`)
      },
      signal,
      vertex: provider!.kind === 'google-vertex',
      project: provider!.project,
      location: provider!.location,
      // Copilot runs its own loop; writes go to the workspace, codebase is at ./codebase.
      cwd: ws.workspaceDir,
      permissions: persona.permissions,
      copilotAllow: persona.copilotTools?.allow,
      copilotDeny: persona.copilotTools?.deny
    })
    // If the agent used the marker, honor exactly what follows it (even if empty);
    // otherwise fall back to its whole final message.
    const block = result.finalText.includes(OUTPUT_MARKER)
      ? extractOutput(result.finalText)
      : result.finalText.trim()
    const { outputs, primary } = toOutputs(block)
    return {
      status: 'done',
      output: out.trim(),
      outputValue: primary,
      outputs,
      summary: summarize(primary || result.finalText, `${persona.name} ran`)
    }
  } catch (err: any) {
    if (signal.aborted) throw err
    return { status: 'error', output: (out + '\n' + (err?.message ?? String(err))).trim() }
  }
}

function runShell(
  command: string,
  cwd: string,
  env: Record<string, string>,
  signal: AbortSignal,
  onProgress?: (text: string) => void
): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    let lastFlush = 0
    const cap = (t: string) => {
      output += t
      if (output.length > 40_000) output = output.slice(-40_000)
      if (onProgress) {
        const now = Date.now()
        if (now - lastFlush > 400) {
          lastFlush = now
          onProgress(`$ ${command}\n${output}`)
        }
      }
    }
    const child = spawn(command, { cwd, shell: true, signal, env: { ...process.env, ...env } })
    child.stdout.on('data', (d) => cap(d.toString()))
    child.stderr.on('data', (d) => cap(d.toString()))
    child.on('error', (e: any) => {
      if (settled) return
      settled = true
      if (signal.aborted || e?.name === 'AbortError') return reject(new Error('Run cancelled.'))
      cap(e.message)
      resolve({ spawnError: true, exitCode: null, output })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (signal.aborted) return reject(new Error('Run cancelled.'))
      resolve({ spawnError: false, exitCode: code ?? null, output })
    })
  })
}

async function runDeterministicStep(
  node: WorkflowNode,
  ws: RunWorkspace,
  signal: AbortSignal,
  resolvedInputs: Record<string, string>,
  onProgress?: (text: string) => void
): Promise<StepResult> {
  let command = node.command ?? ''
  let rules = DEFAULT_RULES
  if (node.processId) {
    const proc = store.getProcess(node.processId)
    if (!proc) return { status: 'error', output: 'Deterministic process not found.' }
    const inputs: Record<string, string> = {}
    for (const inp of proc.inputs) {
      // XCom-pulled value (resolvedInputs) wins over the node's static input,
      // which wins over the process default. An upstream value of "" is a real
      // value and still wins (resolveInputs already omits unbound inputs).
      const xcom = resolvedInputs[inp.name]
      const provided = node.inputs?.[inp.name]
      inputs[inp.name] =
        xcom != null
          ? xcom
          : provided != null && provided.trim() !== ''
            ? provided
            : inp.default ?? ''
    }
    // Declared inputs (with default logic) win; any XCom value not declared as a
    // process input (e.g. a report step's injected `run_results`) is still
    // available for {{name}} / ${name} substitution.
    command = applyInputs(proc.command, { ...resolvedInputs, ...inputs })
    rules = proc.resultRules.length ? (proc.resultRules as typeof DEFAULT_RULES) : DEFAULT_RULES
  } else {
    // Ad-hoc command: still allow XCom values to fill {{name}} placeholders.
    command = applyInputs(command, resolvedInputs)
  }
  if (!command.trim()) return { status: 'error', output: 'No command for this step.' }

  // Commands run in the workspace; the read-only codebase is at ./codebase and
  // $KENNEL_CODEBASE; XCom inputs are also exposed as $XCOM_<name> env vars.
  const xcomEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(resolvedInputs)) xcomEnv[`XCOM_${k}`] = v
  const exec = await runShell(
    command,
    ws.workspaceDir,
    { KENNEL_CODEBASE: ws.codebaseDir, KENNEL_WORKSPACE: ws.workspaceDir, ...xcomEnv },
    signal,
    onProgress
  )
  const inferred = inferResult(rules, exec)
  const stdout = exec.output.trim()
  const { outputs, primary } = toOutputs(stdout || inferred.state)
  return {
    status: exec.spawnError ? 'error' : 'done',
    output: `$ ${command}\n${stdout || '(no output)'}\n[exit ${exec.exitCode ?? '—'}]`,
    outputValue: primary,
    outputs,
    summary: `${inferred.state}`,
    resultState: inferred.state,
    resultStateKind: inferred.kind,
    exitCode: exec.exitCode
  }
}

/** Assemble the whole run's results (every step's output, failures, skipped branches). */
function assembleRunResults(node: WorkflowNode, parkNodes: WorkflowNode[]): string {
  // Summarize every step that actually ran (exclude start + this report).
  const executed = parkNodes.filter(
    (n) => n.id !== node.id && n.kind !== 'start' && (n.status === 'done' || n.status === 'error')
  )
  const skipped = parkNodes.filter((n) => n.kind !== 'start' && n.status === 'skipped')
  const stepBlocks = executed
    .map((n) => {
      const body = (n.outputValue || n.summary || n.output || '(no output)').toString().slice(0, 2500)
      return `## Step: ${n.title} [${n.kind}] — ${n.resultState ?? n.status}\n${n.outputSpec ? `Expected output: ${n.outputSpec}\n` : ''}${body}`
    })
    .join('\n\n')
  const skippedNote = skipped.length
    ? `\n\nSkipped (branch condition not met): ${skipped.map((n) => n.title).join(', ')}.`
    : ''
  return `${stepBlocks || '(no steps ran)'}${skippedNote}`
}

/**
 * Run a Report step. The report WRITER — how the run's data is processed — is a
 * chosen Park capability: a persona (agentic synthesis driven by its system
 * prompt, defaulting to the built-in "Summarize Report") or a process
 * (deterministic; the assembled results are fed in as the `run_results` input).
 */
async function runReportStep(
  node: WorkflowNode,
  parkNodes: WorkflowNode[],
  ws: RunWorkspace,
  signal: AbortSignal,
  onProgress?: (text: string) => void
): Promise<StepResult> {
  const runResults = assembleRunResults(node, parkNodes)

  // Process-driven report: run the chosen process/command with the assembled
  // results provided as the `run_results` input ({{run_results}} + $XCOM_run_results).
  if (node.processId || node.command) {
    const res = await runDeterministicStep(node, ws, signal, { run_results: runResults }, onProgress)
    if (res.status !== 'done') return res
    const report = (res.outputValue || '').toString().trim()
    return { ...res, outputValue: report, summary: summarize(report, 'Report generated') }
  }

  // Persona-driven report: the persona's system prompt defines how to write it.
  // A report node with no (or a deleted) writer falls back to the built-in
  // "Summarize Report" persona, so reports never error for lack of a writer.
  let resolved = resolvePersonaProvider(node.personaId)
  if ('status' in resolved) {
    const fallback = store.getDefaultReportPersona()
    if (fallback && fallback.id !== node.personaId) resolved = resolvePersonaProvider(fallback.id)
  }
  if ('status' in resolved) return resolved
  const { persona, provider, apiKey } = resolved

  const userPrompt =
    (node.prompt ? `Report focus: ${node.prompt}\n\n` : '') +
    `Workflow run results:\n\n${runResults}`

  let out = ''
  let lastFlush = 0
  const cap = (t: string) => {
    out += t
    if (out.length > 60_000) out = out.slice(-60_000)
    if (onProgress) {
      const now = Date.now()
      if (now - lastFlush > 400) {
        lastFlush = now
        onProgress(out)
      }
    }
  }
  try {
    const result = await runWithProvider(provider!.kind, {
      apiKey,
      baseUrl: provider!.baseUrl,
      model: persona.model,
      systemPrompt: persona.systemPrompt,
      userPrompt,
      effort: persona.effort,
      tools: [],
      execute: async () => ({ ok: false, content: 'no tools' }),
      emit: (ev) => {
        if (ev.type === 'assistant') cap(ev.text)
      },
      signal,
      vertex: provider!.kind === 'google-vertex',
      project: provider!.project,
      location: provider!.location,
      // Copilot runs its own loop; writes go to the workspace, codebase is at ./codebase.
      cwd: ws.workspaceDir,
      permissions: persona.permissions,
      copilotAllow: persona.copilotTools?.allow,
      copilotDeny: persona.copilotTools?.deny
    })
    const report = result.finalText.trim() || out.trim()
    return {
      status: 'done',
      output: report,
      outputValue: report,
      summary: summarize(report, 'Report generated')
    }
  } catch (err: any) {
    if (signal.aborted) throw err
    return { status: 'error', output: (out + '\n' + (err?.message ?? String(err))).trim() }
  }
}

/** Run a Park's workflow once in an isolated workspace. */
export async function runWorkflow(
  parkId: string,
  trigger: WorkflowRunTrigger,
  mode: WorkflowRunMode
): Promise<{ runId: string }> {
  const project = store.getProject()
  if (!project) throw new Error('No project is open.')
  const park = store.getPark(parkId)
  if (!park) throw new Error('Park not found.')

  // Workflow runs are serialized — refuse if anything else holds the working tree.
  const token = `wf-${parkId}`
  if (isBusy()) throw new Error('A run is already in progress. Wait for it to finish.')

  const runId = randomUUID()
  const startedAt = Date.now()
  const controller = new AbortController()
  controllers.set(parkId, controller)
  holdWorkingTree(token, controller)

  const order = executionOrder(park.nodes)
  const reset: Park = {
    ...park,
    nodes: park.nodes.map((n) =>
      n.kind === 'start'
        ? { ...n, status: 'done' as const }
        : {
            ...n,
            status: 'idle' as const,
            inputsReceived: undefined,
            output: undefined,
            outputValue: undefined,
            outputs: undefined,
            summary: undefined,
            resultState: undefined,
            resultStateKind: undefined,
            exitCode: undefined
          }
    ),
    lastRun: { id: runId, trigger, mode, status: 'running', startedAt }
  }
  store.upsertPark(reset)
  sendState(store.getState())

  let ws: RunWorkspace | null = null
  let hadError = false
  // nodeId → did its incoming activation condition pass? (undefined = no condition)
  const activated = new Map<string, boolean | undefined>()
  const skipped = new Set<string>()

  try {
    ws = await createRunWorkspace(project.path, park.baseCommit, parkId, runId)

    for (const node of order) {
      if (controller.signal.aborted) throw new Error('Workflow cancelled.')

      const fresh = store.getPark(parkId)?.nodes ?? park.nodes

      // Skip if the parent was skipped/failed-to-run, or this node's condition fails.
      const parentSkipped = node.parentId ? skipped.has(node.parentId) : false
      let skip = parentSkipped
      if (!skip && node.activation) {
        const srcId = node.activation.sourceNodeId || node.parentId || ''
        const source = fresh.find((n) => n.id === srcId)
        const pass = evalActivation(node.activation, source)
        activated.set(node.id, pass)
        skip = !pass
      }
      if (skip) {
        skipped.add(node.id)
        store.patchWorkflowNode(parkId, node.id, {
          status: 'skipped',
          output: parentSkipped ? 'Skipped: an upstream branch was not taken.' : 'Skipped: activation condition not met.',
          outputValue: undefined,
          summary: 'skipped',
          resultState: 'skipped',
          resultStateKind: 'neutral'
        })
        sendState(store.getState())
        continue
      }

      store.patchWorkflowNode(parkId, node.id, { status: 'running' })
      sendState(store.getState())

      // Resolve this node's XCom inputs by pulling bound upstream outputs. Read
      // definition fields (bindings/contract) from the fresh store copy so any
      // edit made before the run is honored consistently.
      const freshNode = fresh.find((n) => n.id === node.id) ?? node
      const contract = capabilityContract(freshNode)
      const byId = new Map(fresh.map((n) => [n.id, n]))
      const resolvedInputs = resolveInputs(contract, freshNode.inputBindings, byId)
      // Record what this node actually received, for the inspector.
      store.patchWorkflowNode(parkId, node.id, {
        inputsReceived: Object.keys(resolvedInputs).length ? resolvedInputs : undefined
      })

      // Stream partial output to the inspector while the step runs.
      const onProgress = (text: string) => {
        store.patchWorkflowNode(parkId, node.id, { output: text })
        sendState(store.getState())
      }

      let res: StepResult
      if (freshNode.kind === 'agentic') {
        res = await runAgenticStep(freshNode, fresh, ws, project.name, controller.signal, resolvedInputs, contract, onProgress)
      } else if (freshNode.kind === 'report') {
        res = await runReportStep(freshNode, fresh, ws, controller.signal, onProgress)
      } else {
        res = await runDeterministicStep(freshNode, ws, controller.signal, resolvedInputs, onProgress)
      }
      if (res.status === 'error') hadError = true
      store.patchWorkflowNode(parkId, node.id, {
        status: res.status,
        output: res.output,
        outputValue: res.outputValue,
        outputs: res.outputs,
        summary: res.summary,
        resultState: res.resultState,
        resultStateKind: res.resultStateKind,
        exitCode: res.exitCode ?? null
      })
      sendState(store.getState())
    }

    const finalNodes = store.getPark(parkId)?.nodes ?? reset.nodes
    const results = buildResults(finalNodes, activated)
    const reportNode = finalNodes.find((n) => n.kind === 'report' && n.status === 'done')
    const run: WorkflowRun = {
      id: runId,
      trigger,
      mode,
      status: hadError ? 'error' : 'done',
      startedAt,
      finishedAt: Date.now(),
      results,
      reportNodeId: reportNode?.id,
      report: reportNode?.outputValue,
      workspacePath: mode === 'recorded' ? ws.workspaceDir : undefined
    }
    finalizeRun(parkId, run)
  } catch (err: any) {
    const cancelled = controller.signal.aborted || /cancel/i.test(err?.message ?? '')
    const finalNodes = store.getPark(parkId)?.nodes ?? reset.nodes
    finalizeRun(parkId, {
      id: runId,
      trigger,
      mode,
      status: 'error',
      startedAt,
      finishedAt: Date.now(),
      results: buildResults(finalNodes, activated),
      error: cancelled ? 'Cancelled.' : err?.message ?? String(err),
      workspacePath: mode === 'recorded' && !cancelled ? ws?.workspaceDir : undefined
    })
  } finally {
    controllers.delete(parkId)
    releaseWorkingTree(token)
    if (ws) await teardownCodebase(project.path, ws).catch(() => {})
    // Temporary runs leave nothing behind; recorded runs keep their workspace.
    if (mode === 'temporary') await discardRun(parkId, runId).catch(() => {})
    sendState(store.getState())
  }

  return { runId }
}

/** Snapshot per-node results for history, recording each node's activation decision. */
function buildResults(
  nodes: WorkflowNode[],
  activated: Map<string, boolean | undefined>
): WorkflowNodeResult[] {
  return nodes
    .filter((n) => n.kind !== 'start')
    .map((n) => ({
      nodeId: n.id,
      title: n.title,
      kind: n.kind,
      status: n.status ?? 'idle',
      outputValue: n.outputValue,
      outputs: n.outputs,
      summary: n.summary,
      resultState: n.resultState,
      resultStateKind: n.resultStateKind,
      exitCode: n.exitCode ?? null,
      activated: activated.get(n.id)
    }))
}

/** Persist a finished run: always update lastRun; recorded runs also enter history. */
function finalizeRun(parkId: string, run: WorkflowRun): void {
  const park = store.getPark(parkId)
  if (!park) return
  const patch: Partial<Park> = { lastRun: run }
  if (run.mode === 'recorded') {
    const history = [run, ...(park.runs ?? [])]
    // Prune beyond the cap and delete the dropped runs' workspaces.
    const kept = history.slice(0, RUN_HISTORY_CAP)
    for (const dropped of history.slice(RUN_HISTORY_CAP)) {
      void discardRun(parkId, dropped.id)
    }
    patch.runs = kept
  }
  store.patchPark(parkId, patch)
}

// ── Single-node isolation runner (used by the Park Care Taker to TEST nodes) ──

export interface IsolatedNodeResult {
  status: NodeStatus
  /** Full activity log / stdout. */
  output: string
  /** Headline output value (return_value). */
  outputValue?: string
  /** Named XCom outputs the node pushed (key → value). */
  outputs?: Record<string, string>
  resultState?: string
  exitCode?: number | null
  error?: string
}

/**
 * Run ONE capability (persona/process) as a workflow node in a fresh isolated
 * workspace against the given sample inputs, and return its result + parsed
 * outputs — WITHOUT touching any Park. Lets the Park Care Taker verify that a
 * node it built actually runs and fulfills its declared output contract, and
 * iterate until it does. Nothing is persisted; the workspace is discarded.
 */
export async function runWorkflowNodeIsolated(opts: {
  /** Park whose frozen codebase to run against; falls back to the active node. */
  parkId?: string
  kind: 'agentic' | 'deterministic'
  personaId?: string
  prompt?: string
  processId?: string
  command?: string
  /** Sample input values, keyed by input name. */
  inputs?: Record<string, string>
  /** The I/O contract being tested (drives prompt + output parsing). */
  contract?: IoContract
  signal: AbortSignal
}): Promise<IsolatedNodeResult> {
  const project = store.getProject()
  if (!project) return { status: 'error', output: '', error: 'No project is open.' }
  if (isBusy()) {
    return { status: 'error', output: '', error: 'A run is in progress — try testing again shortly.' }
  }

  const park = opts.parkId ? store.getPark(opts.parkId) : undefined
  const baseCommit = park?.baseCommit ?? store.getNode(project.activeNodeId)?.commit
  if (!baseCommit) return { status: 'error', output: '', error: 'No codebase snapshot to test against.' }

  const runId = randomUUID()
  const pseudoParkId = opts.parkId ?? 'cttest'
  const token = `cttest-${runId}`
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  opts.signal.addEventListener('abort', onAbort)
  holdWorkingTree(token, controller)

  const node: WorkflowNode = {
    id: randomUUID(),
    parentId: null,
    kind: opts.kind,
    title: 'test',
    personaId: opts.personaId,
    prompt: opts.prompt,
    processId: opts.processId,
    command: opts.command,
    inputs: opts.inputs,
    position: { x: 0, y: 0 },
    createdAt: Date.now()
  }

  let ws: RunWorkspace | null = null
  try {
    ws = await createRunWorkspace(project.path, baseCommit, pseudoParkId, runId)
    const resolved = opts.inputs ?? {}
    const res =
      opts.kind === 'agentic'
        ? await runAgenticStep(node, [], ws, project.name, controller.signal, resolved, opts.contract)
        : await runDeterministicStep(node, ws, controller.signal, resolved)
    return {
      status: res.status,
      output: res.output,
      outputValue: res.outputValue,
      outputs: res.outputs,
      resultState: res.resultState,
      exitCode: res.exitCode ?? null,
      error: res.status === 'error' ? res.output : undefined
    }
  } catch (err: any) {
    const cancelled = controller.signal.aborted || /cancel/i.test(err?.message ?? '')
    return { status: 'error', output: '', error: cancelled ? 'Cancelled.' : err?.message ?? String(err) }
  } finally {
    opts.signal.removeEventListener('abort', onAbort)
    releaseWorkingTree(token)
    if (ws) await teardownCodebase(project.path, ws).catch(() => {})
    await discardRun(pseudoParkId, runId).catch(() => {})
  }
}
