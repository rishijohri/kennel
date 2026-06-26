// ── Shared domain + IPC contract ────────────────────────────────────────────
// These types are the single source of truth shared by the Electron main
// process, the preload bridge, and the React renderer.

export type ProviderKind =
  | 'anthropic'
  | 'openai'
  | 'openai-compatible'
  | 'google'
  | 'google-vertex'

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  /** For openai-compatible (local/hosted) endpoints, e.g. http://localhost:11434/v1 */
  baseUrl?: string
  /** Vertex AI: Google Cloud project id (optional when using an API key). */
  project?: string
  /** Vertex AI: region, e.g. us-central1 (optional when using an API key). */
  location?: string
  /** Default model id to suggest for personas using this provider. */
  defaultModel?: string
  /** Models discovered from the provider's API (cached on the last successful
   *  test/refresh) — used to populate model dropdowns without re-typing. */
  models?: string[]
  /** True if an API key has been stored (the key itself never leaves main). */
  hasKey: boolean
}

export interface Permissions {
  /** May create / modify / delete files in the working tree. */
  canEditFiles: boolean
  /** May execute shell commands. */
  canRunBash: boolean
  /** May modify the protected core-memory location (KENNEL.md / .kennel/memory). */
  canEditCoreMemory: boolean
  /** May search the web with the built-in search tool. */
  canSearchWeb: boolean
  /** May call tools exposed by the configured MCP servers. */
  canUseMcp: boolean
}

// ── MCP servers (Model Context Protocol) ────────────────────────────────────

export type McpTransport = 'stdio' | 'http'

export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  enabled: boolean
  /** stdio: the executable + args to launch, and any env vars it needs. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** http: the streamable-HTTP endpoint URL and any auth headers. */
  url?: string
  headers?: Record<string, string>
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface AgentPersona {
  id: string
  name: string
  /** A single emoji used as the avatar. */
  emoji: string
  /** Hex accent color for the persona. */
  color: string
  providerId: string
  model: string
  systemPrompt: string
  permissions: Permissions
  effort: Effort
  /** Short tagline shown in pickers. */
  role?: string
  /**
   * An Instructor persona: its run output is captured as the node's
   * `instructions`, which then propagate to every agentic descendant of that
   * node (the nearest Instructor ancestor wins). Read-only by design.
   */
  isInstructor?: boolean
  /**
   * Tested XCom I/O contract for using this persona as a workflow node (set by
   * the Park Care Taker). Reusable across parks; surfaced on each node.
   */
  ioContract?: IoContract
  /**
   * Where this persona belongs. 'park' personas are created by the Park Care
   * Taker, follow an I/O contract, and are shown ONLY in Park context — never on
   * the main canvas. Undefined / 'canvas' = a main-canvas persona.
   */
  scope?: 'canvas' | 'park'
  /**
   * For park-scoped personas: the Park that created/owns it. Used when a
   * project disables cross-park sharing — an owned park persona is then visible
   * only inside its owning Park. Undefined = unowned (always shared across the
   * project's Parks, e.g. legacy caps and the built-in report writer).
   */
  ownerParkId?: string
  /**
   * Marks a built-in, auto-seeded persona. 'summarize-report' is the default
   * Park report writer shipped with every Park (selectable for Report steps).
   * Editable like any persona; the marker only keeps seeding idempotent and lets
   * the UI flag it as the default. Undefined = a user/Care-Taker-created persona.
   */
  builtin?: 'summarize-report'
}

// ── Care Taker (project-scoped, off-canvas agent) ───────────────────────────

export interface CaretakerConfig {
  providerId: string
  model: string
}

// ── Walker (project-scoped, off-canvas orchestrator agent) ──────────────────

/**
 * How much latitude the Walker has when working a task:
 * - low    "Cautious"    — small node budget, no creating new capabilities.
 * - medium "Balanced"    — moderate budget, may ask the Care Taker.
 * - high   "Autonomous"  — large budget, free experimentation across branches.
 */
export type WalkerAutonomy = 'low' | 'medium' | 'high'

export interface WalkerConfig {
  providerId: string
  model: string
  /** Last-used autonomy level (default for the next task). */
  autonomy?: WalkerAutonomy
}

// ── Agent conversations (persistent chat history for Care Taker / Walker) ────

/** One message in an agent conversation. */
export interface AgentChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * A persisted conversation with an off-canvas agent. Both the Care Taker and the
 * Walker keep a list of these per project, so a chat survives closing the modal
 * (the run keeps going in the background) and app restarts.
 */
export interface AgentChat {
  id: string
  /** Auto-derived from the first user message; editable. */
  title: string
  messages: AgentChatMessage[]
  createdAt: number
  updatedAt: number
  /** Walker only: the autonomy level this conversation runs at. */
  autonomy?: WalkerAutonomy
}

// ── Deterministic processes (reusable node types) ───────────────────────────

export type ResultStateKind = 'success' | 'failure' | 'neutral'

export type ResultMatch =
  | 'exit-zero'
  | 'exit-nonzero'
  | 'exit-code'
  | 'output-contains'
  | 'output-matches'
  | 'spawn-error'
  | 'default'

export interface ResultStateRule {
  /** The state label this rule assigns, e.g. "success", "needs-deps". */
  state: string
  kind: ResultStateKind
  when: ResultMatch
  /** For 'exit-code'. */
  exitCode?: number
  /** Substring ('output-contains') or regex ('output-matches'). */
  pattern?: string
}

export interface DeterministicInput {
  name: string
  description?: string
  required: boolean
  default?: string
}

// ── XCom I/O contracts (Airflow-style cross-node communication) ──────────────

/**
 * One named field of a workflow capability's I/O contract — an input the node
 * pulls from upstream, or a named output (XCom key) it pushes downstream.
 */
export interface XcomField {
  /** The XCom key / input name (e.g. "changed_files", "report"). */
  key: string
  /** How the value is shaped, e.g. "JSON: string[]", "PASS|FAIL", "absolute path". */
  format: string
  /** A concrete example value, so consumers know exactly what to expect. */
  example?: string
  description?: string
  /** Inputs only: whether the node needs this input to run. */
  required?: boolean
}

/**
 * A capability's tested I/O contract. Lives on the persona/process so it is
 * reusable, and is surfaced on every workflow node that uses it. Authored and
 * verified by the Park Care Taker (Airflow-XCom-style: named inputs/outputs).
 */
export interface IoContract {
  /** Named inputs the node pulls from upstream nodes' outputs. */
  inputs: XcomField[]
  /** Named outputs (XCom keys) the node pushes downstream. */
  outputs: XcomField[]
  /** Sample input values the Care Taker last tested the node with (key → value). */
  sample?: Record<string, string>
  /** True once the Care Taker has run the node and confirmed it fulfills the contract. */
  tested?: boolean
  /** One-line note from the last successful test (how it was verified). */
  testNotes?: string
}

export interface DeterministicProcess {
  id: string
  name: string
  emoji: string
  color: string
  description?: string
  /** Shell command template; {{name}} / ${name} are replaced with input values. */
  command: string
  inputs: DeterministicInput[]
  /** Evaluated in order; first match wins. */
  resultRules: ResultStateRule[]
  /** Tested XCom I/O contract (set by the Park Care Taker). */
  ioContract?: IoContract
  /** 'park' processes are Park-only (created by the Park Care Taker); 'canvas'/undefined = main canvas. */
  scope?: 'canvas' | 'park'
  /** For park-scoped processes: the owning Park (see AgentPersona.ownerParkId). */
  ownerParkId?: string
  createdAt: number
}

export type NodeKind = 'root' | 'agentic' | 'deterministic' | 'park'
/** 'skipped' only occurs in Park workflows when a node's activation condition is false. */
export type NodeStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped'

/** A Park node either runs on demand (trigger) or on a cron schedule. */
export type ParkKind = 'trigger' | 'schedule'

export interface DiffStat {
  filesChanged: number
  insertions: number
  deletions: number
}

export interface CanvasNode {
  id: string
  parentId: string | null
  /** Git commit SHA whose tree IS this node's codebase state. */
  commit: string
  title: string
  kind: NodeKind
  status: NodeStatus
  /** Persona used for an agentic step. */
  personaId?: string
  /** The user's prompt for an agentic step. */
  prompt?: string
  /**
   * Short, precise instructions this node established (set when an Instructor
   * persona runs here). Inherited by every agentic descendant until a deeper
   * Instructor node overrides them.
   */
  instructions?: string
  /** The shell command for a deterministic step. */
  command?: string
  /** The deterministic process this node ran, if any. */
  processId?: string
  /** Input values supplied to the process. */
  inputs?: Record<string, string>
  /** For kind='park': whether it triggers on demand or on a schedule. */
  parkKind?: ParkKind
  /** Inferred result-state label (e.g. "success", "failed to start"). */
  resultState?: string
  resultStateKind?: ResultStateKind
  /** One-line human summary of what changed. */
  summary?: string
  diffStat?: DiffStat
  createdAt: number
  position: { x: number; y: number }
  error?: string
}

export interface Project {
  id: string
  name: string
  /** Absolute path to the real folder backing this project. */
  path: string
  rootNodeId: string
  /** The node currently checked out into the working tree. */
  activeNodeId: string
  /**
   * Whether park-scoped personas/processes are shared across ALL of this
   * project's Parks (true / undefined = shared, the default) or isolated so each
   * Park only sees the capabilities it owns (false). Per-project setting.
   */
  shareParkCapabilities?: boolean
  createdAt: number
}

// ── Parks (nested, runnable workflow canvases) ──────────────────────────────

/**
 * Kinds of workflow step:
 * - start         the single root of a Park's graph.
 * - agentic       a persona runs a focused task and produces a declared output.
 * - deterministic a saved process / command runs; output is its stdout.
 * - report        synthesizes a report of the whole run's outputs, using a
 *                  chosen Park persona (agentic) or process (deterministic) as
 *                  the report writer — defaults to the built-in "Summarize Report".
 */
export type WorkflowNodeKind = 'start' | 'agentic' | 'deterministic' | 'report'

/** The field of an upstream node's last result that an activation condition tests. */
export type ActivationField =
  | 'resultState'
  | 'resultStateKind'
  | 'outputValue'
  | 'output'
  | 'exitCode'
  | 'status'

/** Comparison operator for an activation condition (the value is the tunable knob). */
export type ActivationOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'notContains'
  | 'matches'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'truthy'
  | 'falsy'

/**
 * Gates a node's incoming edge: the node (and its whole subtree) runs only when
 * this condition holds against an upstream node's last-run result. The Walker
 * tweaks `value` across repeated runs to find the values that branch correctly.
 */
export interface ActivationCondition {
  /** Upstream node whose result is tested. Defaults to this node's parent. */
  sourceNodeId?: string
  field: ActivationField
  op: ActivationOp
  /** Comparison value — ignored for truthy/falsy. The tunable knob. */
  value?: string
}

/**
 * A node in a Park's workflow graph. Unlike a CanvasNode it is a *definition*
 * (no git commit of its own); the transient last-run result is stored back onto
 * it (status/output/...) so the canvas can show it.
 */
export interface WorkflowNode {
  id: string
  /** Parent within the workflow graph; the start node has null. */
  parentId: string | null
  kind: WorkflowNodeKind
  title: string
  /** agentic, or a report written by a persona (the report writer). */
  personaId?: string
  prompt?: string
  /** deterministic, or a report produced by a process (the report writer). */
  command?: string
  processId?: string
  inputs?: Record<string, string>
  /**
   * Declared description of what this step OUTPUTS (authored). Every non-start
   * step is expected to produce a concrete `outputValue` fulfilling this, which
   * downstream steps and activation conditions consume.
   */
  outputSpec?: string
  /**
   * XCom input wiring: maps each of the capability's declared input names to the
   * upstream node + output key it pulls from at run time. Set by the Walker when
   * wiring the workflow; the capability's contract lives on the persona/process.
   */
  inputBindings?: Record<string, { sourceNodeId: string; key: string }>
  /** Condition gating this node's incoming edge; false ⇒ node + subtree skipped. */
  activation?: ActivationCondition
  position: { x: number; y: number }
  createdAt: number
  // ── transient last-run result ──
  status?: NodeStatus
  /** The XCom inputs this node ACTUALLY received on its last run (key → value). */
  inputsReceived?: Record<string, string>
  /** Raw activity log (assistant text, tool calls, stdout) for inspection. */
  output?: string
  /** The curated output that fulfills `outputSpec` (passed to descendants). */
  outputValue?: string
  /** Named XCom outputs this node pushed on its last run (key → value). */
  outputs?: Record<string, string>
  summary?: string
  resultState?: string
  resultStateKind?: ResultStateKind
  /** Deterministic exit code from the last run, when applicable (for conditions). */
  exitCode?: number | null
}

export type WorkflowRunTrigger = 'manual' | 'schedule' | 'walker'

/**
 * Temporary runs are throwaway (Walker builds with these; their workspace is
 * deleted on completion). Recorded runs persist to the Park's run history with
 * their workspace, per-node outputs, and report.
 */
export type WorkflowRunMode = 'temporary' | 'recorded'

/** Per-node result captured at run end, so recorded history is self-contained. */
export interface WorkflowNodeResult {
  nodeId: string
  title: string
  kind: WorkflowNodeKind
  status: NodeStatus
  outputValue?: string
  /** Named XCom outputs this node pushed (key → value). */
  outputs?: Record<string, string>
  summary?: string
  resultState?: string
  resultStateKind?: ResultStateKind
  exitCode?: number | null
  /** Activation decision: did this node's incoming condition pass? undefined ⇒ none. */
  activated?: boolean
}

export interface WorkflowRun {
  id: string
  trigger: WorkflowRunTrigger
  mode: WorkflowRunMode
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt?: number
  error?: string
  /** Per-node results (recorded runs keep these for history browsing). */
  results?: WorkflowNodeResult[]
  /** Absolute path to the persisted run workspace (recorded runs only). */
  workspacePath?: string
  /** Id of the report node whose output is the run's headline report, if any. */
  reportNodeId?: string
  /** The synthesized report markdown, if the run produced one. */
  report?: string
}

/**
 * A Park: a node on the main canvas (kind='park') that owns a separate workflow
 * graph. The workflow runs against `baseCommit` (the codebase of the node the
 * Park was created from), in an isolated workspace each run.
 */
export interface Park {
  /** Same id as the kind='park' CanvasNode on the main canvas. */
  id: string
  name: string
  parkKind: ParkKind
  /** The main-canvas node the Park was created from. */
  parentNodeId: string
  /**
   * The clear objective this workflow must fulfill — what "done" means for the
   * Park. Set by the Walker (or user) at the start of building, shown in the UI,
   * and kept stable as the Walker iterates toward it.
   */
  objective?: string
  /** Codebase snapshot the workflow reads against (frozen at park creation). */
  baseCommit: string
  /** Cron expression (5-field) for schedule parks; '' otherwise. */
  cron: string
  scheduleEnabled: boolean
  /** Workflow graph (always includes exactly one kind='start' node). */
  nodes: WorkflowNode[]
  /** Most recent execution (per-node detail also lives transiently on the nodes). */
  lastRun: WorkflowRun | null
  /** Recorded run history, newest first (temporary runs are not kept). */
  runs?: WorkflowRun[]
  createdAt: number
}

export interface CreateWorkflowNodeInput {
  parentId: string
  kind: Exclude<WorkflowNodeKind, 'start'>
  title: string
  personaId?: string
  prompt?: string
  command?: string
  processId?: string
  inputs?: Record<string, string>
  outputSpec?: string
  activation?: ActivationCondition
  position: { x: number; y: number }
}

export interface KennelState {
  providers: ProviderConfig[]
  /** Personas available in the open project (a subset of the global library). */
  personas: AgentPersona[]
  /** Deterministic processes belonging to the open project. */
  deterministicProcesses: DeterministicProcess[]
  /** MCP servers added to the open project (a subset of the global store). */
  mcpServers: McpServerConfig[]
  /** The global persona library — every persona ever created (for "Add existing"). */
  personaLibrary: AgentPersona[]
  /** The global MCP store — every server ever configured (for "Add existing"). */
  mcpLibrary: McpServerConfig[]
  caretaker: CaretakerConfig | null
  walker: WalkerConfig | null
  /** The currently open project, or null on the home screen. */
  project: Project | null
  /** Nodes of the currently open project. */
  nodes: CanvasNode[]
  /** Parks (workflow canvases) of the currently open project. */
  parks: Park[]
  /** Care Taker conversations for the open project, newest first. */
  caretakerChats: AgentChat[]
  /** Walker conversations for the open project, newest first. */
  walkerChats: AgentChat[]
  /** Conversation the Care Taker is actively running (null when idle). Transient. */
  caretakerRunningChatId: string | null
  /** Conversation the Walker is actively running (null when idle). Transient. */
  walkerRunningChatId: string | null
  /** All known projects (each keeps its own canvas history), newest first. */
  recentProjects: Project[]
}

// ── Care Taker chat events (main → renderer) ────────────────────────────────

export interface CaretakerMessage {
  role: 'user' | 'assistant'
  content: string
}

export type CaretakerEvent =
  | { type: 'start'; chatId: string }
  | { type: 'thinking'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown; callId: string }
  | { type: 'tool_result'; callId: string; ok: boolean; preview: string }
  | { type: 'status'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

// ── Walker events (main → renderer) ─────────────────────────────────────────

export interface WalkerMessage {
  role: 'user' | 'assistant'
  content: string
}

export type WalkerEvent =
  | { type: 'start'; chatId: string }
  | { type: 'thinking'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown; callId: string }
  | { type: 'tool_result'; callId: string; ok: boolean; preview: string }
  | { type: 'status'; text: string }
  /** The Walker created a canvas node — lets the renderer focus it. */
  | { type: 'spawned'; nodeId: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

// ── Run streaming events (main → renderer) ──────────────────────────────────

export type RunEvent =
  | { runId: string; nodeId: string; type: 'start'; at: number }
  | { runId: string; nodeId: string; type: 'thinking'; text: string }
  | { runId: string; nodeId: string; type: 'assistant'; text: string }
  | {
      runId: string
      nodeId: string
      type: 'tool_call'
      tool: string
      input: unknown
      callId: string
    }
  | {
      runId: string
      nodeId: string
      type: 'tool_result'
      callId: string
      ok: boolean
      preview: string
    }
  | { runId: string; nodeId: string; type: 'status'; text: string }
  | { runId: string; nodeId: string; type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | {
      runId: string
      nodeId: string
      type: 'done'
      node: CanvasNode
      at: number
    }
  | { runId: string; nodeId: string; type: 'error'; message: string; at: number }

// ── Filesystem snapshot view ────────────────────────────────────────────────

export interface FileEntry {
  name: string
  path: string // relative to project root
  isDir: boolean
}

export interface FileNodeTree {
  name: string
  path: string
  isDir: boolean
  children?: FileNodeTree[]
}

/** A single file changed by a node, relative to its parent. */
export interface NodeChange {
  /** Path (the new path for renames). */
  path: string
  /** git status: A added, M modified, D deleted, R renamed, C copied, T type-change. */
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T'
  /** Original path for renames/copies. */
  oldPath?: string
}

/** Before/after content for one changed file, for the read-only viewer/diff. */
export interface NodeFileDiff {
  path: string
  status: NodeChange['status']
  oldPath?: string
  /** Parent-version content (null if the file was added). */
  before: string | null
  /** Node-version content (null if the file was deleted). */
  after: string | null
  /** True if the file is binary or too large to display as text. */
  binary: boolean
}

// ── IPC request payloads ────────────────────────────────────────────────────

export interface CreateAgenticRunInput {
  parentNodeId: string
  personaId: string
  prompt: string
  position: { x: number; y: number }
}

export interface CreateDeterministicRunInput {
  parentNodeId: string
  title: string
  command: string
  position: { x: number; y: number }
}

export interface RunProcessInput {
  parentNodeId: string
  processId: string
  inputs: Record<string, string>
  position: { x: number; y: number }
}

export interface SaveProviderInput {
  provider: Omit<ProviderConfig, 'hasKey'>
  /** When provided, (re)sets the stored API key. Empty string clears it. */
  apiKey?: string
}

// ── Local model server (llama.cpp, downloaded at runtime) ───────────────────

/**
 * Advanced server options. Every field is optional: a value is only passed to
 * llama-server when the user explicitly enables/sets it. Omitted fields fall
 * back to llama.cpp's own defaults.
 */
export interface LocalAdvancedOptions {
  /** Use this external llama-server binary instead of the downloaded engine. */
  binaryPath?: string
  /** --flash-attn on (omitted → llama.cpp default 'auto'). */
  flashAttention?: boolean
  /** -b, --batch-size: logical maximum batch size. */
  batchSize?: number
  /** -ub, --ubatch-size: physical maximum batch size. */
  ubatchSize?: number
  /** -t, --threads: CPU threads for generation. */
  threads?: number
  /** -np, --parallel: number of server slots. */
  parallel?: number
  /** --mlock: keep the model in RAM. */
  mlock?: boolean
  /** --no-mmap: disable memory-mapping the model. */
  noMmap?: boolean
}

export interface LocalServerConfig {
  /** Path to the GGUF model file. */
  modelPath: string
  /** Context window size (--ctx-size / -c). */
  ctxSize: number
  /** HTTP port for the OpenAI-compatible endpoint. */
  port: number
  /** GPU layers to offload (-ngl); 999 = all (Metal on Apple Silicon). */
  gpuLayers: number
  /** Enable the model's chat template / tool-calling (--jinja). */
  jinja: boolean
  /** Optional served model name (--alias). */
  alias?: string
  /** Advanced, opt-in server options (incl. external binary override). */
  advanced?: LocalAdvancedOptions
}

export interface LocalDefaults {
  /** Resolved path to the active downloaded llama-server engine (null if none). */
  binaryPath: string | null
  /** Platform label we download for, e.g. "macos-arm64" (null if unsupported). */
  binaryPlatform: string | null
  suggestedPort: number
}

/** A user-added GGUF model (chip) in the Local Models section. */
export interface LocalModel {
  path: string
  name: string
}

/**
 * Persisted Local Models settings — restored when the panel mounts so the user
 * doesn't have to re-enter their model list and server parameters every session.
 */
export interface LocalSettings {
  /** Last-used server configuration (null until the user sets one). */
  config: LocalServerConfig | null
  /** The user-curated list of model files. */
  models: LocalModel[]
}

export interface LocalServerStatus {
  running: boolean
  starting: boolean
  config: LocalServerConfig | null
  baseUrl: string | null
  providerId: string | null
  error: string | null
  /** Tail of the server log (stdout+stderr). */
  log: string
}

// ── llama.cpp engine releases (downloaded at runtime from GitHub) ────────────

/** A llama.cpp GitHub release, with the single asset matching this platform. */
export interface LlamaRelease {
  /** Build tag, e.g. "b4321". */
  tag: string
  /** Release title (often same as tag). */
  name: string
  /** ISO timestamp the release was published. */
  publishedAt: string
  /** Release notes (markdown body), trimmed for display. */
  notes: string
  /** Link to the release page on GitHub. */
  htmlUrl: string
  prerelease: boolean
  /** The asset for THIS platform+arch, or null if the release has none. */
  asset: { name: string; url: string; size: number } | null
}

/** A downloaded, ready-to-run llama.cpp build living under userData. */
export interface LlamaInstall {
  tag: string
  /** Platform label this build is for, e.g. "macos-arm64". */
  platform: string
  /** Resolved path to the llama-server executable. */
  binaryPath: string
  installedAt: number
}

/** State of the installed engines, for the UI. */
export interface LlamaEngineState {
  /** Platform+arch label we download for, e.g. "macos-arm64". */
  platform: string
  installs: LlamaInstall[]
  /** Tag of the active build (used to run the server), or null. */
  activeTag: string | null
}

// ── HuggingFace recommended models (unsloth GGUF) ────────────────────────────

export interface HfModel {
  /** Repo id, e.g. "unsloth/Qwen2.5-Coder-7B-Instruct-GGUF". */
  repo: string
  /** Display name (repo without the org prefix). */
  name: string
  downloads: number
  likes: number
  updatedAt: string
}

export interface HfModelFile {
  repo: string
  /** GGUF filename within the repo. */
  filename: string
  /** Size in bytes if known. */
  size: number | null
  /** Direct download (resolve) URL. */
  url: string
}

/** Streamed progress for a llama-engine or model download. */
export interface DownloadProgress {
  /** Stable id for the download (tag for engines, repo/file for models). */
  id: string
  kind: 'llama' | 'model'
  label: string
  receivedBytes: number
  totalBytes: number
  phase: 'downloading' | 'extracting' | 'installing' | 'done' | 'error'
  message?: string
}

// ── The API surface exposed on window.kennel via the preload bridge ─────────

export interface KennelApi {
  getState(): Promise<KennelState>

  // Providers
  saveProvider(input: SaveProviderInput): Promise<KennelState>
  deleteProvider(id: string): Promise<KennelState>
  testProvider(id: string): Promise<{ ok: boolean; message: string; models?: string[] }>
  /** Reassign every persona on this provider+model to a new model. Returns the
   *  new state and how many personas were switched. `scope`: 'project' = active
   *  project's personas only; 'library' = every persona globally. */
  switchProviderModel(input: {
    providerId: string
    fromModel: string
    toModel: string
    scope: 'project' | 'library'
  }): Promise<{ state: KennelState; switched: number }>

  // Personas — a global library; each project includes a chosen subset.
  /** Create/update a persona in the library and ensure it's in the open project. */
  savePersona(persona: AgentPersona): Promise<KennelState>
  /** Add an existing library persona to the open project. */
  addPersonaToProject(personaId: string): Promise<KennelState>
  /** Remove a persona from the open project (keeps it in the library). */
  removePersonaFromProject(personaId: string): Promise<KennelState>
  /** Delete a persona from the library entirely (and from every project). */
  deletePersonaFromLibrary(personaId: string): Promise<KennelState>

  // Deterministic processes — per project (no global library).
  saveProcess(process: DeterministicProcess): Promise<KennelState>
  deleteProcess(id: string): Promise<KennelState>

  // MCP servers — a global store; each project includes a chosen subset.
  saveMcpServer(server: McpServerConfig): Promise<KennelState>
  addMcpServerToProject(id: string): Promise<KennelState>
  removeMcpServerFromProject(id: string): Promise<KennelState>
  deleteMcpServerFromLibrary(id: string): Promise<KennelState>
  testMcpServer(
    server: McpServerConfig
  ): Promise<{ ok: boolean; message: string; tools?: string[] }>
  /** Decrypted env/headers for the editor to pre-fill (not in getState). */
  getMcpServerSecrets(
    id: string
  ): Promise<{ env?: Record<string, string>; headers?: Record<string, string> }>

  // Care Taker
  saveCaretaker(config: CaretakerConfig | null): Promise<KennelState>
  /** Start a new conversation; returns the new chat id plus refreshed state. */
  createCaretakerChat(): Promise<{ chatId: string; state: KennelState }>
  deleteCaretakerChat(chatId: string): Promise<KennelState>
  renameCaretakerChat(chatId: string, title: string): Promise<KennelState>
  /** Run a turn in a conversation. The transcript is owned & persisted by main. */
  runCaretaker(input: { chatId: string; message: string }): Promise<void>
  cancelCaretaker(): Promise<void>

  // Walker (autonomous canvas orchestrator)
  saveWalker(config: WalkerConfig | null): Promise<KennelState>
  createWalkerChat(): Promise<{ chatId: string; state: KennelState }>
  deleteWalkerChat(chatId: string): Promise<KennelState>
  renameWalkerChat(chatId: string, title: string): Promise<KennelState>
  runWalker(input: {
    chatId: string
    message: string
    autonomy: WalkerAutonomy
    /** When a Park is open, the Walker builds & runs that Park's workflow. */
    parkId?: string
  }): Promise<void>
  cancelWalker(): Promise<void>

  // Project
  pickFolder(): Promise<string | null>
  openProject(path: string): Promise<KennelState>
  closeProject(): Promise<KennelState>
  /** Forget a project and its canvas history (e.g. remove from recents). */
  removeProject(id: string): Promise<KennelState>

  // Parks (workflow canvases)
  createPark(input: {
    parentNodeId: string
    name: string
    parkKind: ParkKind
    position: { x: number; y: number }
  }): Promise<KennelState>
  deletePark(parkId: string): Promise<KennelState>
  /** Toggle whether park personas/processes are shared across the project's Parks. */
  setShareParkCapabilities(shared: boolean): Promise<KennelState>
  saveParkSchedule(parkId: string, cron: string, enabled: boolean): Promise<KennelState>
  addWorkflowNode(parkId: string, node: CreateWorkflowNodeInput): Promise<KennelState>
  updateWorkflowNode(
    parkId: string,
    nodeId: string,
    patch: Partial<WorkflowNode>
  ): Promise<KennelState>
  deleteWorkflowNode(parkId: string, nodeId: string): Promise<KennelState>
  setWorkflowNodePositions(
    parkId: string,
    updates: { id: string; position: { x: number; y: number } }[]
  ): Promise<void>
  runWorkflow(parkId: string, mode: WorkflowRunMode): Promise<{ runId: string }>
  cancelWorkflow(parkId: string): Promise<void>
  /** File tree of a recorded run's persisted workspace (null if not on disk). */
  getRunWorkspaceTree(parkId: string, runId: string): Promise<FileNodeTree | null>
  /** Read one file from a recorded run's persisted workspace. */
  getRunWorkspaceFile(parkId: string, runId: string, relPath: string): Promise<string>

  // Canvas / nodes
  selectNode(nodeId: string): Promise<KennelState>
  updateNodePosition(nodeId: string, position: { x: number; y: number }): Promise<void>
  /** Bulk position update (e.g. auto-arrange) — persisted in one write. */
  updateNodePositions(
    updates: { id: string; position: { x: number; y: number } }[]
  ): Promise<void>
  deleteNode(nodeId: string): Promise<KennelState>

  // Runs
  runAgentic(input: CreateAgenticRunInput): Promise<{ runId: string; nodeId: string }>
  runDeterministic(
    input: CreateDeterministicRunInput
  ): Promise<{ runId: string; nodeId: string }>
  runProcess(input: RunProcessInput): Promise<{ runId: string; nodeId: string }>
  cancelRun(runId: string): Promise<void>

  // Snapshot inspection
  getFileTree(nodeId: string): Promise<FileNodeTree | null>
  getFileContent(nodeId: string, relPath: string): Promise<string>
  /** Files this node changed vs its parent, each with a git status letter. */
  getNodeChanges(nodeId: string): Promise<NodeChange[]>
  /** Before/after content for one changed file (read-only viewer + diff). */
  getNodeFileDiff(nodeId: string, relPath: string): Promise<NodeFileDiff | null>

  // Local model server
  getLocalDefaults(): Promise<LocalDefaults>
  getLocalStatus(): Promise<LocalServerStatus>
  /** Persisted Local Models settings (config + model list) from the last session. */
  getLocalSettings(): Promise<LocalSettings>
  /** Persist the last-used server configuration. */
  saveLocalConfig(config: LocalServerConfig | null): Promise<void>
  /** Persist the curated model list. */
  saveLocalModels(models: LocalModel[]): Promise<void>
  startLocalServer(config: LocalServerConfig): Promise<LocalServerStatus>
  stopLocalServer(): Promise<LocalServerStatus>
  pickModelFile(): Promise<string | null>
  pickBinaryFile(): Promise<string | null>

  // llama.cpp engine — fetched from GitHub and downloaded at runtime.
  /** List recent llama.cpp releases, each with the asset matching this platform. */
  listLlamaReleases(): Promise<LlamaRelease[]>
  /** Installed engine builds + which one is active. */
  getLlamaEngines(): Promise<LlamaEngineState>
  /** Download + install a release (streams DownloadProgress); resolves to the new state. */
  downloadLlamaRelease(tag: string): Promise<LlamaEngineState>
  /** Make an installed build the active engine. */
  setActiveLlama(tag: string): Promise<LlamaEngineState>
  /** Delete an installed build from disk. */
  removeLlama(tag: string): Promise<LlamaEngineState>

  // HuggingFace recommended models (unsloth GGUF). Browsing/adding a local file
  // is unchanged (pickModelFile) — these are recommendations only.
  listHfModels(query?: string): Promise<HfModel[]>
  listHfModelFiles(repo: string): Promise<HfModelFile[]>
  /** Download a GGUF into the local models dir (streams progress); resolves to its path. */
  downloadHfModel(file: HfModelFile): Promise<string>

  // First-run local-LLM setup prompt (skippable; persisted machine-global).
  getLocalSetupSeen(): Promise<boolean>
  setLocalSetupSeen(seen: boolean): Promise<void>

  // Wake Mode — prevent the device from sleeping while working.
  /** Toggle Wake Mode; resolves with the resulting on/off state. */
  setWakeMode(enabled: boolean): Promise<boolean>
  /** Current Wake Mode state (it's process-global, transient, defaults off). */
  getWakeMode(): Promise<boolean>

  // Streaming
  onRunEvent(cb: (e: RunEvent) => void): () => void
  onStateChanged(cb: (s: KennelState) => void): () => void
  onLocalStatus(cb: (s: LocalServerStatus) => void): () => void
  onCaretakerEvent(cb: (e: CaretakerEvent) => void): () => void
  onWalkerEvent(cb: (e: WalkerEvent) => void): () => void
  /** Progress of in-flight engine/model downloads. */
  onDownloadProgress(cb: (p: DownloadProgress) => void): () => void
}

declare global {
  interface Window {
    kennel: KennelApi
  }
}
