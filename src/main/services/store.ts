import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentChat,
  AgentChatMessage,
  AgentPersona,
  CanvasNode,
  CaretakerConfig,
  DeterministicProcess,
  KennelState,
  LocalModel,
  LocalServerConfig,
  McpServerConfig,
  Park,
  Permissions,
  Project,
  ProviderConfig,
  WalkerConfig,
  WorkflowNode
} from '@shared/types'

/** A project plus its own canvas graph. Each project keeps its history so the
 *  user can close, switch, and reopen projects without losing their canvas. */
interface ProjectRecord {
  project: Project
  nodes: CanvasNode[]
  /** Parks (nested workflow canvases) belonging to this project. */
  parks: Park[]
  /** Ids of the library personas included in this project. */
  personaIds: string[]
  /** Deterministic processes belonging to this project (not shared globally). */
  deterministicProcesses: DeterministicProcess[]
  /** Ids of the global MCP servers added to this project. */
  mcpServerIds: string[]
  /** Persistent Care Taker conversations for this project. */
  caretakerChats: AgentChat[]
  /** Persistent Walker conversations for this project. */
  walkerChats: AgentChat[]
}

/** Which agent's conversation list to operate on. */
type ChatAgent = 'caretaker' | 'walker'

interface PersistShape {
  providers: ProviderConfig[]
  /** The global persona library. Projects reference a subset by id. */
  personas: AgentPersona[]
  /** The global MCP server store. Projects reference a subset by id. */
  mcpServers: McpServerConfig[]
  caretaker: CaretakerConfig | null
  walker: WalkerConfig | null
  /** Last-used Local Models server configuration (machine-global). */
  localConfig: LocalServerConfig | null
  /** Curated GGUF model list for the Local Models section (machine-global). */
  localModels: LocalModel[]
  /** Tag of the active downloaded llama.cpp engine build (machine-global). */
  llamaActiveTag?: string | null
  /** Whether the first-run local-LLM setup prompt has been seen/dismissed. */
  localSetupSeen?: boolean
  /** All known projects, each with its own node graph. */
  projects: ProjectRecord[]
  /** The currently open project, or null when on the home screen. */
  activeProjectId: string | null
}

/** Legacy persist shape (pre per-project personas/processes/MCP), for migration. */
interface LegacyPersistShape {
  project?: Project | null
  nodes?: CanvasNode[]
  /** Global deterministic processes (now per-project) — copied into each project. */
  deterministicProcesses?: DeterministicProcess[]
}

/** Encrypted-at-rest API keys, keyed by provider id. Values are base64 ciphertext. */
type KeyVault = Record<string, string>

const dataDir = () => app.getPath('userData')
const stateFile = () => join(dataDir(), 'kennel-state.json')
const keysFile = () => join(dataDir(), 'kennel-keys.json')

function defaultPersonas(): AgentPersona[] {
  const base = {
    color: '#7c6cff',
    effort: 'high' as const,
    permissions: { canEditFiles: false, canRunBash: false, canEditCoreMemory: false, canSearchWeb: false, canUseMcp: false }
  }
  return [
    {
      ...base,
      id: randomUUID(),
      name: 'Instructor',
      emoji: '🧭',
      role: 'Sets short, precise instructions for all work beneath it',
      color: '#7c6cff',
      providerId: '',
      model: 'claude-opus-4-8',
      isInstructor: true,
      systemPrompt:
        'You are the Instructor. Investigate only as much as needed (you may read files and run ' +
        'read-only commands), then output SHORT, PRECISE, ACTIONABLE instructions that the agents ' +
        'working below you must follow — conventions to honor, the approach to take, constraints, ' +
        'and what "done" looks like. Your ENTIRE output IS the instruction set; it is automatically ' +
        'given to every agentic node beneath you. Be terse: a tight list of imperative directives, ' +
        'no preamble, no restating the task, no prose. Do NOT edit files. If existing instructions ' +
        'were given to you, produce the updated, complete instruction set (not a diff).',
      permissions: { canEditFiles: false, canRunBash: true, canEditCoreMemory: false, canSearchWeb: false, canUseMcp: false }
    },
    {
      ...base,
      id: randomUUID(),
      name: 'Ask',
      emoji: '💬',
      role: 'Answers questions, read-only',
      color: '#4fd6a8',
      providerId: '',
      model: 'claude-opus-4-8',
      systemPrompt:
        'You are Ask. Answer the user’s questions about this codebase precisely. Read any files ' +
        'you need. You never modify files or run commands.',
      permissions: { canEditFiles: false, canRunBash: false, canEditCoreMemory: false, canSearchWeb: false, canUseMcp: false }
    },
    {
      ...base,
      id: randomUUID(),
      name: 'Worker',
      emoji: '🔧',
      role: 'Implements changes end-to-end',
      color: '#ffb454',
      providerId: '',
      model: 'claude-opus-4-8',
      systemPrompt:
        'You are the Worker. Implement the requested change in this codebase. Read the relevant ' +
        'files, make focused edits, and run commands when needed to verify your work. Keep changes ' +
        'minimal and correct. Summarize what you did at the end.',
      permissions: { canEditFiles: true, canRunBash: true, canEditCoreMemory: false, canSearchWeb: false, canUseMcp: false }
    }
  ]
}

/** The exact old default Planner prompt — we only replace this verbatim text,
 *  so any user customization (even one that opens the same way) is preserved. */
const LEGACY_PLANNER_PROMPT =
  'You are the Planner. Analyze the codebase and the user request, then produce a clear, ' +
  'step-by-step implementation plan. You may read files to understand the project. Do NOT ' +
  'edit files or run commands — your output is the plan itself.'

/**
 * Migrate a persisted persona forward. The built-in "Planner" persona is
 * repurposed as the "Instructor" (whose output becomes instructions for its
 * descendants). We ONLY migrate the PRISTINE default Planner — matched by name
 * AND its exact default prompt. A persona named "Planner" with any other prompt
 * is treated as the user's own and left untouched: default persona ids aren't
 * stable, so an edited default is indistinguishable from a user-created one, and
 * silently re-roling it (it would start injecting instructions into every
 * descendant) would be surprising. New projects ship the Instructor directly.
 */
function migratePersona(p: AgentPersona): AgentPersona {
  if (p.name !== 'Planner' || p.isInstructor || p.systemPrompt.trim() !== LEGACY_PLANNER_PROMPT) {
    return p
  }
  const instructorDefault = defaultPersonas().find((d) => d.isInstructor)!
  return {
    ...p,
    name: 'Instructor',
    isInstructor: true,
    role: instructorDefault.role,
    systemPrompt: instructorDefault.systemPrompt
  }
}

/** The report-writing instructions that drive the built-in Summarize Report persona. */
const REPORT_WRITER_PROMPT =
  'You are the Summarize Report writer for a Park workflow. You are given the RESULTS of every ' +
  'step that ran in this workflow (their declared outputs, result states, and any failures or ' +
  'skipped branches) in the user message. Write a clear, well-structured Markdown report that ' +
  'communicates the outcome to a human: lead with the headline result, summarize what the ' +
  'workflow did and found step by step, and call out failures and skipped branches explicitly. ' +
  'Output ONLY the Markdown report — no preamble.'

/**
 * The default "Summarize Report" Park persona, shipped with every Park. It is a
 * park-scoped persona the user or Walker can select as a Report step's writer
 * (or use as a template). Provider/model are assigned by ensureParkDefaults from
 * the project's configured providers; an empty providerId means "assign later".
 */
function summarizeReportPersona(providerId: string, model: string): AgentPersona {
  return {
    id: randomUUID(),
    name: 'Summarize Report',
    emoji: '📝',
    color: '#56d6a0',
    role: 'Writes a Markdown report of the whole run',
    providerId,
    model,
    systemPrompt: REPORT_WRITER_PROMPT,
    effort: 'high',
    permissions: {
      canEditFiles: false,
      canRunBash: false,
      canEditCoreMemory: false,
      canSearchWeb: false,
      canUseMcp: false
    },
    scope: 'park',
    builtin: 'summarize-report',
    ioContract: {
      inputs: [
        {
          key: 'run_results',
          format: 'Markdown',
          description: "Every step's declared output, result-state, failures and skipped branches",
          example: '## Step: Run tests [deterministic] — failed\n3 tests failing…',
          required: true
        }
      ],
      outputs: [
        {
          key: 'report',
          format: 'Markdown',
          description: 'A human-readable report of the whole run',
          example: '# Run report\n**Outcome:** 3 tests failing…'
        }
      ],
      tested: true,
      testNotes: 'Built-in report writer — synthesizes the run results into Markdown.'
    }
  }
}

/** A readable process name for an auto-registered quick command. Prefers a
 *  meaningful user title; otherwise derives a short label from the command. */
function commandProcessName(title: string, command: string): string {
  const t = title.trim()
  if (t && t.toLowerCase() !== 'task') return t
  const firstLine = command.split('\n')[0].trim()
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine || 'Command'
}

function defaultProcesses(): DeterministicProcess[] {
  const now = Date.now()
  return [
    {
      id: randomUUID(),
      name: 'Install dependencies',
      emoji: '📦',
      color: '#ffb454',
      description: 'Install project dependencies.',
      command: 'npm install',
      inputs: [],
      resultRules: [
        { state: 'installed', kind: 'success', when: 'exit-zero' },
        { state: 'failed', kind: 'failure', when: 'exit-nonzero' },
        { state: 'failed to start', kind: 'failure', when: 'spawn-error' }
      ],
      createdAt: now
    },
    {
      id: randomUUID(),
      name: 'Run tests',
      emoji: '🧪',
      color: '#4fd6a8',
      description: 'Run the test suite.',
      command: '{{command}}',
      inputs: [
        { name: 'command', description: 'Test command', required: true, default: 'npm test' }
      ],
      resultRules: [
        { state: 'passing', kind: 'success', when: 'exit-zero' },
        { state: 'failing', kind: 'failure', when: 'exit-nonzero' },
        { state: 'failed to start', kind: 'failure', when: 'spawn-error' }
      ],
      createdAt: now
    }
  ]
}

/** Newest-updated first; returns a fresh sorted array (never mutates input). */
function sortChats(chats: AgentChat[] | undefined): AgentChat[] {
  return [...(chats ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** A one-line title derived from the first user message of a conversation. */
function titleFromMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 48 ? t.slice(0, 48) + '…' : t || 'New conversation'
}

class Store {
  private state: PersistShape
  private keys: KeyVault
  // Transient (never persisted): which conversation each agent is actively
  // running. Reset to null on process start, so a crashed run is never stuck;
  // surfaced in getState() so a freshly-loaded renderer can rebind to a live run.
  private runningChats: { caretaker: string | null; walker: string | null } = {
    caretaker: null,
    walker: null
  }

  constructor() {
    this.ensureDir()
    this.state = this.loadState()
    this.keys = this.loadKeys()
  }

  private ensureDir() {
    const dir = dataDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  /** A node still marked "running" means a previous session crashed mid-run. */
  private healNodes(nodes: CanvasNode[]): CanvasNode[] {
    return (nodes ?? []).map((n) =>
      n.status === 'running'
        ? { ...n, status: 'error' as const, error: n.error ?? 'Interrupted by app restart.' }
        : n
    )
  }

  private loadState(): PersistShape {
    try {
      if (existsSync(stateFile())) {
        const parsed = JSON.parse(readFileSync(stateFile(), 'utf8')) as PersistShape &
          LegacyPersistShape & { projects?: (ProjectRecord & Partial<ProjectRecord>)[] }
        // The global persona library (was `personas`).
        const library = parsed.personas?.length ? parsed.personas : defaultPersonas()
        const allPersonaIds = library.map((p) => p.id)
        const allMcpIds = (parsed.mcpServers ?? []).map((m) => m.id)
        // Pre-split-model projects shared one global process list — copy it into
        // each project (deep clone so edits stay project-local).
        const legacyProcs = parsed.deterministicProcesses
        const seedProcs = (): DeterministicProcess[] =>
          (legacyProcs ?? defaultProcesses()).map((p) => ({ ...p, inputs: [...p.inputs], resultRules: [...p.resultRules] }))

        // Migrate the legacy single-project shape into the per-project model.
        let projects: ProjectRecord[]
        let activeProjectId: string | null
        const adapt = (r: any): ProjectRecord => ({
          project: r.project,
          nodes: this.healNodes(r.nodes),
          parks: r.parks ?? [],
          // Older projects saw all personas/MCPs globally — preserve that on migrate.
          personaIds: r.personaIds ?? allPersonaIds,
          deterministicProcesses: r.deterministicProcesses ?? seedProcs(),
          mcpServerIds: r.mcpServerIds ?? allMcpIds,
          caretakerChats: r.caretakerChats ?? [],
          walkerChats: r.walkerChats ?? []
        })
        if (Array.isArray(parsed.projects)) {
          projects = parsed.projects.map(adapt)
          activeProjectId = parsed.activeProjectId ?? null
        } else if (parsed.project) {
          projects = [adapt({ project: parsed.project, nodes: parsed.nodes ?? [] })]
          activeProjectId = parsed.project.id
        } else {
          projects = []
          activeProjectId = null
        }
        // Guard against a dangling active id.
        if (activeProjectId && !projects.some((r) => r.project.id === activeProjectId)) {
          activeProjectId = null
        }
        return {
          providers: parsed.providers ?? [],
          personas: library.map((p) => migratePersona({
            ...p,
            // Fill permission fields added in later versions so old personas
            // still satisfy the Permissions contract.
            permissions: {
              canEditFiles: false,
              canRunBash: false,
              canEditCoreMemory: false,
              canSearchWeb: false,
              canUseMcp: false,
              ...(p.permissions as Partial<Permissions>)
            }
          })),
          mcpServers: parsed.mcpServers ?? [],
          caretaker: parsed.caretaker ?? null,
          walker: parsed.walker ?? null,
          localConfig: parsed.localConfig ?? null,
          localModels: parsed.localModels ?? [],
          llamaActiveTag: parsed.llamaActiveTag ?? null,
          localSetupSeen: parsed.localSetupSeen ?? false,
          projects,
          activeProjectId
        }
      }
    } catch (err) {
      console.error('[store] failed to read state, starting fresh:', err)
    }
    return {
      providers: [],
      personas: defaultPersonas(),
      mcpServers: [],
      caretaker: null,
      walker: null,
      localConfig: null,
      localModels: [],
      projects: [],
      activeProjectId: null
    }
  }

  private loadKeys(): KeyVault {
    try {
      if (existsSync(keysFile())) {
        return JSON.parse(readFileSync(keysFile(), 'utf8')) as KeyVault
      }
    } catch (err) {
      console.error('[store] failed to read keys:', err)
    }
    return {}
  }

  /** Atomic write: serialize to a temp file then rename over the target. */
  private writeAtomic(file: string, data: string) {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, data, 'utf8')
    renameSync(tmp, file)
  }

  private persistState() {
    this.writeAtomic(stateFile(), JSON.stringify(this.state, null, 2))
  }

  private persistKeys() {
    this.writeAtomic(keysFile(), JSON.stringify(this.keys, null, 2))
  }

  /** The currently open project record, or undefined when on the home screen. */
  private activeRecord(): ProjectRecord | undefined {
    return this.state.projects.find((r) => r.project.id === this.state.activeProjectId)
  }

  /** Public view of state, with hasKey resolved from the vault. */
  /** Library personas included in a project, in the order they were added. */
  private projectPersonas(rec: ProjectRecord | undefined): AgentPersona[] {
    if (!rec) return []
    return rec.personaIds.map((id) => this.state.personas.find((p) => p.id === id)).filter(Boolean) as AgentPersona[]
  }

  /** Global MCP servers (metadata only) added to a project. */
  private projectMcpMeta(rec: ProjectRecord | undefined): McpServerConfig[] {
    if (!rec) return []
    return rec.mcpServerIds.map((id) => this.state.mcpServers.find((m) => m.id === id)).filter(Boolean) as McpServerConfig[]
  }

  getState(): KennelState {
    const active = this.activeRecord()
    return {
      providers: this.state.providers.map((p) => ({ ...p, hasKey: Boolean(this.keys[p.id]) })),
      personas: this.projectPersonas(active),
      deterministicProcesses: active?.deterministicProcesses ?? [],
      mcpServers: this.projectMcpMeta(active),
      personaLibrary: this.state.personas,
      mcpLibrary: this.state.mcpServers,
      caretaker: this.state.caretaker,
      walker: this.state.walker,
      project: active?.project ?? null,
      nodes: active?.nodes ?? [],
      parks: active?.parks ?? [],
      caretakerChats: sortChats(active?.caretakerChats),
      walkerChats: sortChats(active?.walkerChats),
      caretakerRunningChatId: this.runningChats.caretaker,
      walkerRunningChatId: this.runningChats.walker,
      // Most-recently-created first, for the home screen's recent list.
      recentProjects: this.state.projects.map((r) => r.project).sort((a, b) => b.createdAt - a.createdAt)
    }
  }

  // ── Providers ──────────────────────────────────────────────────────────
  upsertProvider(provider: Omit<ProviderConfig, 'hasKey'>, apiKey?: string) {
    const idx = this.state.providers.findIndex((p) => p.id === provider.id)
    const existing = idx >= 0 ? this.state.providers[idx] : undefined
    // Preserve discovered models / chosen default when the caller (e.g. the edit
    // form, which no longer has those fields) doesn't supply them.
    const stored: ProviderConfig = {
      ...provider,
      defaultModel: provider.defaultModel ?? existing?.defaultModel,
      models: provider.models ?? existing?.models,
      hasKey: false
    }
    if (idx >= 0) this.state.providers[idx] = stored
    else this.state.providers.push(stored)

    if (apiKey !== undefined) {
      if (apiKey === '') {
        delete this.keys[provider.id]
      } else if (safeStorage.isEncryptionAvailable()) {
        // Tag the scheme so reads never guess: 'enc:' = OS-encrypted ciphertext.
        this.keys[provider.id] = 'enc:' + safeStorage.encryptString(apiKey).toString('base64')
      } else {
        // Fallback (e.g. Linux without a keyring) — base64 so the app still works.
        this.keys[provider.id] = 'raw:' + Buffer.from(apiKey, 'utf8').toString('base64')
      }
      this.persistKeys()
    }
    this.persistState()
  }

  deleteProvider(id: string) {
    this.state.providers = this.state.providers.filter((p) => p.id !== id)
    delete this.keys[id]
    this.persistKeys()
    this.persistState()
  }

  /**
   * Reassign every persona on `providerId`+`fromModel` to `toModel`. `scope`:
   * 'library' switches all personas globally; 'project' only those in the active
   * project. Personas are shared library defs, so 'project' still edits the
   * shared definition (consistent with how persona editing works). Returns count.
   */
  switchProviderModel(
    providerId: string,
    fromModel: string,
    toModel: string,
    scope: 'project' | 'library'
  ): number {
    const rec = this.activeRecord()
    // 'project' scope is always bounded by the active project's membership — with
    // no open project that is the EMPTY set (switch nothing), never the whole library.
    const memberIds = scope === 'project' ? new Set(rec?.personaIds ?? []) : null
    let switched = 0
    for (const p of this.state.personas) {
      if (
        p.providerId === providerId &&
        p.model === fromModel &&
        (!memberIds || memberIds.has(p.id))
      ) {
        p.model = toModel
        switched++
      }
    }
    if (switched > 0) this.persistState()
    return switched
  }

  getApiKey(providerId: string): string | null {
    const stored = this.keys[providerId]
    if (!stored) return null
    try {
      if (stored.startsWith('enc:')) {
        if (!safeStorage.isEncryptionAvailable()) return null
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      }
      if (stored.startsWith('raw:')) {
        return Buffer.from(stored.slice(4), 'base64').toString('utf8')
      }
      // Legacy (unprefixed) value — best-effort decode for backward compatibility.
      const buf = Buffer.from(stored, 'base64')
      return safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buf)
        : buf.toString('utf8')
    } catch {
      return null
    }
  }

  getProvider(id: string): ProviderConfig | undefined {
    const p = this.state.providers.find((x) => x.id === id)
    return p ? { ...p, hasKey: Boolean(this.keys[id]) } : undefined
  }

  /** Cache the models discovered from a provider's API; adopt the first as the
   *  default model when none has been chosen yet. Keeps the chosen default in the
   *  list even if the provider stops returning it, so it stays visible/selectable
   *  (the card always highlights a default) rather than becoming a ghost. */
  setProviderModels(id: string, models: string[]): void {
    const p = this.state.providers.find((x) => x.id === id)
    if (!p) return
    p.models =
      p.defaultModel && !models.includes(p.defaultModel) ? [p.defaultModel, ...models] : models
    if (!p.defaultModel && p.models.length) p.defaultModel = p.models[0]
    this.persistState()
  }

  // ── Personas (global library + per-project membership) ───────────────────
  /** Create/update a persona in the library; ensure it's in the active project. */
  upsertPersona(persona: AgentPersona) {
    const idx = this.state.personas.findIndex((p) => p.id === persona.id)
    if (idx >= 0) this.state.personas[idx] = persona
    else this.state.personas.push(persona)
    const rec = this.activeRecord()
    if (rec && !rec.personaIds.includes(persona.id)) rec.personaIds.push(persona.id)
    this.persistState()
  }

  /** Add an existing library persona to the active project. */
  addPersonaToProject(id: string) {
    const rec = this.activeRecord()
    if (!rec) return
    if (this.state.personas.some((p) => p.id === id) && !rec.personaIds.includes(id)) {
      rec.personaIds.push(id)
      this.persistState()
    }
  }

  /** Remove a persona from the active project (keeps the library definition). */
  removePersonaFromProject(id: string) {
    const rec = this.activeRecord()
    if (!rec) return
    rec.personaIds = rec.personaIds.filter((pid) => pid !== id)
    this.persistState()
  }

  /** Delete a persona from the library and from every project that uses it. */
  deletePersonaFromLibrary(id: string) {
    this.state.personas = this.state.personas.filter((p) => p.id !== id)
    for (const r of this.state.projects) r.personaIds = r.personaIds.filter((pid) => pid !== id)
    this.persistState()
  }

  /** Library lookup by id (personas are globally stored, used per-project). */
  getPersona(id: string): AgentPersona | undefined {
    return this.state.personas.find((p) => p.id === id)
  }

  /** Personas available in the active project (for agents to choose from). */
  getProjectPersonas(): AgentPersona[] {
    return this.projectPersonas(this.activeRecord())
  }

  /** The active project's built-in Summarize Report park persona, if present. */
  getDefaultReportPersona(): AgentPersona | undefined {
    return this.projectPersonas(this.activeRecord()).find((p) => p.builtin === 'summarize-report')
  }

  /** Pick a usable provider+model for an auto-seeded persona (first ready provider). */
  private pickSeedProvider(): { providerId: string; model: string } {
    // Mirror the runner's usability rule: openai-compatible (keyless), a stored
    // key, or a Vertex provider with ADC (project + location) all count as ready.
    const usable = (p: ProviderConfig) =>
      p.kind === 'openai-compatible' ||
      Boolean(this.keys[p.id]) ||
      (p.kind === 'google-vertex' && Boolean(p.project) && Boolean(p.location))
    const ready = this.state.providers.find(usable) ?? this.state.providers[0]
    if (!ready) return { providerId: '', model: 'claude-opus-4-8' }
    return {
      providerId: ready.id,
      model: ready.defaultModel ?? ready.models?.[0] ?? 'claude-opus-4-8'
    }
  }

  /**
   * Ensure the active project ships the built-in "Summarize Report" Park persona,
   * so every Park has a default report writer the user or Walker can pick. Seeds a
   * fresh PER-PROJECT copy when absent; if one exists but was seeded before any
   * provider was configured (empty providerId), back-fills a now-available
   * provider/model. Idempotent. Returns the persona, or undefined with no project.
   */
  ensureParkDefaults(): AgentPersona | undefined {
    const rec = this.activeRecord()
    if (!rec) return undefined
    const existing = this.getDefaultReportPersona()
    if (existing) {
      // Repair a persona stranded with no provider once one becomes available.
      if (!existing.providerId) {
        const { providerId, model } = this.pickSeedProvider()
        if (providerId) {
          existing.providerId = providerId
          existing.model = model
          this.persistState()
        }
      }
      return existing
    }
    const { providerId, model } = this.pickSeedProvider()
    const persona = summarizeReportPersona(providerId, model)
    this.state.personas.push(persona)
    rec.personaIds.push(persona.id)
    this.persistState()
    return persona
  }

  // ── Deterministic processes (per project) ────────────────────────────────
  upsertProcess(process: DeterministicProcess) {
    const rec = this.activeRecord()
    if (!rec) return
    const idx = rec.deterministicProcesses.findIndex((p) => p.id === process.id)
    if (idx >= 0) rec.deterministicProcesses[idx] = process
    else rec.deterministicProcesses.push(process)
    this.persistState()
  }

  deleteProcess(id: string) {
    const rec = this.activeRecord()
    if (!rec) return
    rec.deterministicProcesses = rec.deterministicProcesses.filter((p) => p.id !== id)
    this.persistState()
  }

  getProcess(id: string): DeterministicProcess | undefined {
    return this.activeRecord()?.deterministicProcesses.find((p) => p.id === id)
  }

  getProcesses(): DeterministicProcess[] {
    return this.activeRecord()?.deterministicProcesses ?? []
  }

  /**
   * Find (or register) a deterministic process for an ad-hoc/quick command so it
   * is tracked in the project's process registry and shown in the sidebar. Every
   * deterministic command — including UI "quick commands" — becomes a registered,
   * reusable process. Deduped by (scope, exact command) so re-running the same
   * quick command reuses its process. Returns the process; undefined with no project.
   */
  findOrCreateCommandProcess(
    scope: 'canvas' | 'park',
    title: string,
    command: string
  ): DeterministicProcess | undefined {
    const rec = this.activeRecord()
    if (!rec) return undefined
    const cmd = command.trim()
    const existing = rec.deterministicProcesses.find(
      (p) => p.command === cmd && (scope === 'park' ? p.scope === 'park' : p.scope !== 'park')
    )
    if (existing) return existing
    const palette = ['#ffb454', '#4fd6a8', '#56b6ff', '#c678dd', '#e5c07b', '#56d6a0']
    const proc: DeterministicProcess = {
      id: randomUUID(),
      name: commandProcessName(title, cmd),
      emoji: '⚡',
      color: palette[rec.deterministicProcesses.length % palette.length],
      description: 'Quick command, auto-registered as a reusable process.',
      command: cmd,
      inputs: [],
      resultRules: [
        { state: 'success', kind: 'success', when: 'exit-zero' },
        { state: 'failed', kind: 'failure', when: 'exit-nonzero' },
        { state: 'failed to start', kind: 'failure', when: 'spawn-error' }
      ],
      scope: scope === 'park' ? 'park' : undefined,
      createdAt: Date.now()
    }
    rec.deterministicProcesses.push(proc)
    this.persistState()
    return proc
  }

  // ── MCP servers ────────────────────────────────────────────────────────────
  // Secret-bearing fields (env / headers) are encrypted in the key vault, never
  // written to the plaintext state file nor broadcast to the renderer. Only
  // non-secret metadata lives in state.mcpServers.

  private encodeSecret(plain: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(plain).toString('base64')
    }
    return 'raw:' + Buffer.from(plain, 'utf8').toString('base64')
  }

  private decodeSecret(stored: string | undefined): string | null {
    if (!stored) return null
    try {
      if (stored.startsWith('enc:')) {
        return safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
          : null
      }
      if (stored.startsWith('raw:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8')
      return null
    } catch {
      return null
    }
  }

  private mcpSecrets(id: string): { env?: Record<string, string>; headers?: Record<string, string> } {
    const dec = this.decodeSecret(this.keys['mcp:' + id])
    if (!dec) return {}
    try {
      const o = JSON.parse(dec)
      return { env: o.env, headers: o.headers }
    } catch {
      return {}
    }
  }

  /** Create/update a server in the store; ensure it's added to the active project. */
  upsertMcpServer(server: McpServerConfig) {
    const { env, headers, ...meta } = server
    const idx = this.state.mcpServers.findIndex((m) => m.id === server.id)
    if (idx >= 0) this.state.mcpServers[idx] = meta
    else this.state.mcpServers.push(meta)
    // Only rewrite secrets when the caller actually supplied them (the edit form
    // does; the list's enable toggle sends only redacted metadata — preserve).
    if (env !== undefined || headers !== undefined) {
      this.keys['mcp:' + server.id] = this.encodeSecret(
        JSON.stringify({ env: env ?? {}, headers: headers ?? {} })
      )
      this.persistKeys()
    }
    const rec = this.activeRecord()
    if (rec && !rec.mcpServerIds.includes(server.id)) rec.mcpServerIds.push(server.id)
    this.persistState()
  }

  addMcpServerToProject(id: string) {
    const rec = this.activeRecord()
    if (!rec) return
    if (this.state.mcpServers.some((m) => m.id === id) && !rec.mcpServerIds.includes(id)) {
      rec.mcpServerIds.push(id)
      this.persistState()
    }
  }

  removeMcpServerFromProject(id: string) {
    const rec = this.activeRecord()
    if (!rec) return
    rec.mcpServerIds = rec.mcpServerIds.filter((mid) => mid !== id)
    this.persistState()
  }

  /** Delete a server from the store, its vault secret, and every project. */
  deleteMcpServerFromLibrary(id: string) {
    this.state.mcpServers = this.state.mcpServers.filter((m) => m.id !== id)
    delete this.keys['mcp:' + id]
    for (const r of this.state.projects) r.mcpServerIds = r.mcpServerIds.filter((mid) => mid !== id)
    this.persistKeys()
    this.persistState()
  }

  /** The ACTIVE PROJECT's servers WITH secrets merged — main-only (connecting). */
  getMcpServers(): McpServerConfig[] {
    return this.projectMcpMeta(this.activeRecord()).map((m) => ({ ...m, ...this.mcpSecrets(m.id) }))
  }

  /** Any server by id (across the store) WITH secrets — main-only (tool routing). */
  getMcpServer(id: string): McpServerConfig | undefined {
    const base = this.state.mcpServers.find((m) => m.id === id)
    return base ? { ...base, ...this.mcpSecrets(id) } : undefined
  }

  /** Decrypted secrets for the editor to pre-fill (never broadcast). */
  getMcpServerSecrets(id: string): { env?: Record<string, string>; headers?: Record<string, string> } {
    return this.mcpSecrets(id)
  }

  // ── Care Taker ───────────────────────────────────────────────────────────
  setCaretaker(config: CaretakerConfig | null) {
    this.state.caretaker = config
    this.persistState()
  }

  getCaretaker(): CaretakerConfig | null {
    return this.state.caretaker
  }

  // ── Walker ─────────────────────────────────────────────────────────────────
  setWalker(config: WalkerConfig | null) {
    this.state.walker = config
    this.persistState()
  }

  getWalker(): WalkerConfig | null {
    return this.state.walker
  }

  // ── Agent conversations (Care Taker / Walker chat history) ──────────────────
  // Stored per project so each project keeps its own conversations. A run owns
  // the transcript in main, so closing the modal never loses an in-flight chat.

  private chatsFor(agent: ChatAgent): AgentChat[] | undefined {
    const rec = this.activeRecord()
    if (!rec) return undefined
    return agent === 'caretaker' ? rec.caretakerChats : rec.walkerChats
  }

  getChats(agent: ChatAgent): AgentChat[] {
    return sortChats(this.chatsFor(agent))
  }

  getChat(agent: ChatAgent, id: string): AgentChat | undefined {
    return this.chatsFor(agent)?.find((c) => c.id === id)
  }

  /** Create an empty conversation and return it (null when no project is open). */
  createChat(agent: ChatAgent): AgentChat | null {
    const list = this.chatsFor(agent)
    if (!list) return null
    const now = Date.now()
    const chat: AgentChat = {
      id: randomUUID(),
      title: 'New conversation',
      messages: [],
      createdAt: now,
      updatedAt: now,
      ...(agent === 'walker' ? { autonomy: this.state.walker?.autonomy ?? 'medium' } : {})
    }
    list.push(chat)
    this.persistState()
    return chat
  }

  appendChatMessage(agent: ChatAgent, id: string, message: AgentChatMessage): void {
    const chat = this.getChat(agent, id)
    if (!chat) return
    // Name an untitled conversation after its first user message — but never
    // clobber a title the user has deliberately set (keyed off the placeholder).
    if (message.role === 'user' && chat.title === 'New conversation') {
      chat.title = titleFromMessage(message.content)
    }
    chat.messages.push(message)
    chat.updatedAt = Date.now()
    this.persistState()
  }

  renameChat(agent: ChatAgent, id: string, title: string): void {
    const chat = this.getChat(agent, id)
    if (!chat) return
    chat.title = title.trim().slice(0, 80) || chat.title
    chat.updatedAt = Date.now()
    this.persistState()
  }

  deleteChat(agent: ChatAgent, id: string): void {
    const rec = this.activeRecord()
    if (!rec) return
    if (agent === 'caretaker') rec.caretakerChats = rec.caretakerChats.filter((c) => c.id !== id)
    else rec.walkerChats = rec.walkerChats.filter((c) => c.id !== id)
    this.persistState()
  }

  setChatAutonomy(id: string, autonomy: AgentChat['autonomy']): void {
    const chat = this.getChat('walker', id)
    if (!chat) return
    chat.autonomy = autonomy
    this.persistState()
  }

  /** Mark (or clear) the conversation an agent is actively running. Transient. */
  setRunningChat(agent: ChatAgent, chatId: string | null): void {
    this.runningChats[agent] = chatId
  }

  // ── Local Models settings (machine-global, restored each session) ───────────
  getLocalConfig(): LocalServerConfig | null {
    return this.state.localConfig
  }

  setLocalConfig(config: LocalServerConfig | null): void {
    this.state.localConfig = config
    this.persistState()
  }

  getLocalModels(): LocalModel[] {
    return this.state.localModels
  }

  setLocalModels(models: LocalModel[]): void {
    // Dedupe by path, keep order; tolerate malformed input.
    const seen = new Set<string>()
    this.state.localModels = (Array.isArray(models) ? models : [])
      .filter((m) => m && typeof m.path === 'string' && m.path)
      .filter((m) => (seen.has(m.path) ? false : (seen.add(m.path), true)))
      .map((m) => ({ path: m.path, name: m.name || m.path.split(/[/\\]/).pop() || m.path }))
    this.persistState()
  }

  getLlamaActiveTag(): string | null {
    return this.state.llamaActiveTag ?? null
  }

  setLlamaActiveTag(tag: string | null): void {
    this.state.llamaActiveTag = tag
    this.persistState()
  }

  getLocalSetupSeen(): boolean {
    return this.state.localSetupSeen ?? false
  }

  setLocalSetupSeen(seen: boolean): void {
    this.state.localSetupSeen = seen
    this.persistState()
  }

  // ── Projects / nodes ───────────────────────────────────────────────────────

  /** All known projects (each keeps its own canvas), newest first. */
  getProjects(): Project[] {
    return this.state.projects.map((r) => r.project).sort((a, b) => b.createdAt - a.createdAt)
  }

  getProjectByPath(path: string): Project | undefined {
    return this.state.projects.find((r) => r.project.path === path)?.project
  }

  /** Add (or replace) a project with its initial node graph and make it active. */
  addProject(project: Project, nodes: CanvasNode[]) {
    const idx = this.state.projects.findIndex((r) => r.project.id === project.id)
    const record: ProjectRecord = {
      project,
      nodes,
      parks: [],
      // A new project starts with the whole CANVAS library available (curate
      // per-project by removing) and its own copy of the default processes. Park
      // personas are per-project (the Park Care Taker / built-in report writer
      // create them per project), so a new project never inherits another
      // project's park personas — it seeds its own via ensureParkDefaults.
      personaIds: this.state.personas.filter((p) => p.scope !== 'park').map((p) => p.id),
      deterministicProcesses: defaultProcesses(),
      mcpServerIds: [],
      caretakerChats: [],
      walkerChats: []
    }
    if (idx >= 0) this.state.projects[idx] = record
    else this.state.projects.push(record)
    this.state.activeProjectId = project.id
    this.persistState()
  }

  /** Open an existing project (by id) — make it the active one. Home if null. */
  setActiveProject(projectId: string | null) {
    if (projectId && !this.state.projects.some((r) => r.project.id === projectId)) return
    this.state.activeProjectId = projectId
    this.persistState()
    // Retrofit existing projects that already have Parks with the built-in report writer.
    if (projectId && (this.activeRecord()?.parks.length ?? 0) > 0) this.ensureParkDefaults()
  }

  /** Set whether park personas/processes are shared across the active project's Parks. */
  setShareParkCapabilities(shared: boolean) {
    const rec = this.activeRecord()
    if (!rec) return
    rec.project.shareParkCapabilities = shared
    this.persistState()
  }

  /** Close the active project — return to the home screen (history is kept). */
  closeActiveProject() {
    this.state.activeProjectId = null
    this.persistState()
  }

  /** Remove a project and its graph entirely (e.g. from the recents list).
   *  Returns the removed record so callers can clean up its git refs. */
  removeProject(projectId: string): ProjectRecord | undefined {
    const removed = this.state.projects.find((r) => r.project.id === projectId)
    this.state.projects = this.state.projects.filter((r) => r.project.id !== projectId)
    if (this.state.activeProjectId === projectId) this.state.activeProjectId = null
    this.persistState()
    return removed
  }

  getProject(): Project | null {
    return this.activeRecord()?.project ?? null
  }

  setActiveNode(nodeId: string) {
    const rec = this.activeRecord()
    if (rec) {
      rec.project = { ...rec.project, activeNodeId: nodeId }
      this.persistState()
    }
  }

  /** Focus the canvas on a node's subtree (collapse everything else), or clear it
   *  with null. Only a real non-root node can be focused; anything else clears. */
  setFocusedNode(nodeId: string | null) {
    const rec = this.activeRecord()
    if (!rec) return
    const node = nodeId ? this.getNode(nodeId) : undefined
    const focusedNodeId = node && node.kind !== 'root' ? nodeId : null
    rec.project = { ...rec.project, focusedNodeId }
    this.persistState()
  }

  getNodes(): CanvasNode[] {
    return this.activeRecord()?.nodes ?? []
  }

  getNode(id: string): CanvasNode | undefined {
    return this.activeRecord()?.nodes.find((n) => n.id === id)
  }

  upsertNode(node: CanvasNode) {
    const rec = this.activeRecord()
    if (!rec) return
    const idx = rec.nodes.findIndex((n) => n.id === node.id)
    if (idx >= 0) rec.nodes[idx] = node
    else rec.nodes.push(node)
    this.persistState()
  }

  patchNode(id: string, patch: Partial<CanvasNode>) {
    const rec = this.activeRecord()
    if (!rec) return
    const idx = rec.nodes.findIndex((n) => n.id === id)
    if (idx >= 0) {
      rec.nodes[idx] = { ...rec.nodes[idx], ...patch }
      this.persistState()
    }
  }

  /** Apply many node positions at once (one persist) — for canvas auto-arrange. */
  patchPositions(updates: { id: string; position: { x: number; y: number } }[]) {
    const rec = this.activeRecord()
    if (!rec) return
    const byId = new Map(updates.map((u) => [u.id, u.position]))
    rec.nodes = rec.nodes.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n))
    this.persistState()
  }

  deleteNode(id: string) {
    const rec = this.activeRecord()
    if (!rec) return
    rec.nodes = rec.nodes.filter((n) => n.id !== id)
    this.persistState()
  }

  replaceNodes(nodes: CanvasNode[]) {
    const rec = this.activeRecord()
    if (!rec) return
    rec.nodes = nodes
    this.persistState()
  }

  // ── Parks (workflow canvases) ──────────────────────────────────────────────
  getParks(): Park[] {
    return this.activeRecord()?.parks ?? []
  }

  getPark(parkId: string): Park | undefined {
    return this.activeRecord()?.parks.find((p) => p.id === parkId)
  }

  upsertPark(park: Park) {
    const rec = this.activeRecord()
    if (!rec) return
    const idx = rec.parks.findIndex((p) => p.id === park.id)
    if (idx >= 0) rec.parks[idx] = park
    else rec.parks.push(park)
    this.persistState()
  }

  patchPark(parkId: string, patch: Partial<Park>) {
    const rec = this.activeRecord()
    if (!rec) return
    const idx = rec.parks.findIndex((p) => p.id === parkId)
    if (idx >= 0) {
      rec.parks[idx] = { ...rec.parks[idx], ...patch }
      this.persistState()
    }
  }

  deletePark(parkId: string) {
    const rec = this.activeRecord()
    if (!rec) return
    rec.parks = rec.parks.filter((p) => p.id !== parkId)
    this.persistState()
  }

  /** Patch a single workflow node inside a park (used during runs and edits). */
  patchWorkflowNode(parkId: string, nodeId: string, patch: Partial<WorkflowNode>) {
    const rec = this.activeRecord()
    if (!rec) return
    const park = rec.parks.find((p) => p.id === parkId)
    if (!park) return
    const idx = park.nodes.findIndex((n) => n.id === nodeId)
    if (idx >= 0) {
      park.nodes[idx] = { ...park.nodes[idx], ...patch }
      this.persistState()
    }
  }
}

export const store = new Store()
