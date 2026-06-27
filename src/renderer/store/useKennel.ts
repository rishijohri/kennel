import { create } from 'zustand'
import type {
  AgentPersona,
  CanvasNode,
  CaretakerConfig,
  CaretakerEvent,
  CreateWorkflowNodeInput,
  DeterministicProcess,
  DownloadProgress,
  KennelState,
  LlamaEngineState,
  LocalServerStatus,
  McpServerConfig,
  ParkKind,
  RunEvent,
  SaveProviderInput,
  UpdateState,
  WalkerAutonomy,
  WalkerConfig,
  WalkerEvent,
  WorkflowNode,
  WorkflowRunMode
} from '@shared/types'

export type LogEntry =
  | { id: string; kind: 'status'; text: string }
  | { id: string; kind: 'thinking'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | {
      id: string
      kind: 'tool'
      callId: string
      tool: string
      input: unknown
      ok?: boolean
      preview?: string
    }
  | { id: string; kind: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'done'; text: string }

export interface Toast {
  id: string
  kind: 'error' | 'info' | 'success'
  message: string
}

export interface LauncherPrefill {
  mode: 'agentic' | 'deterministic'
  personaId?: string
  prompt?: string
  title?: string
  command?: string
  /** Deterministic sub-mode: rerun a process with its inputs. */
  detKind?: 'command' | 'process'
  processId?: string
  inputs?: Record<string, string>
}

/** Live state of an agent's in-progress assistant turn (Care Taker / Walker). */
export interface CaretakerStream {
  text: string
  status?: string
  thinking: boolean
  tools: { callId: string; tool: string; ok?: boolean }[]
}
export type WalkerStream = CaretakerStream

let seq = 0
const nextId = () => `l${seq++}`

// Register the main→renderer listeners exactly once, even under StrictMode's
// double-invoked effects, so events aren't applied twice.
let listenersBound = false

// A stable, non-null default so selectors like `s.state.nodes` always return a
// stable array reference. Returning a fresh `[]` from a selector makes Zustand's
// useSyncExternalStore loop forever (React error #185).
const EMPTY_STATE: KennelState = {
  providers: [],
  personas: [],
  deterministicProcesses: [],
  mcpServers: [],
  personaLibrary: [],
  mcpLibrary: [],
  caretaker: null,
  walker: null,
  project: null,
  nodes: [],
  parks: [],
  caretakerChats: [],
  walkerChats: [],
  caretakerRunningChatId: null,
  walkerRunningChatId: null,
  recentProjects: []
}
export const EMPTY_LOG: LogEntry[] = []

interface KennelStore {
  state: KennelState | null
  ready: boolean
  selectedNodeId: string | null
  settingsOpen: boolean
  settingsTab: 'providers' | 'personas' | 'local' | 'mcp'
  /** When set, the launcher adds a workflow step to this park instead of running. */
  launcher: { parentId: string; prefill?: LauncherPrefill; parkId?: string } | null
  /** The park whose workflow canvas is currently open, or null for the main canvas. */
  openParkId: string | null
  logs: Record<string, LogEntry[]>
  /** nodeId -> active runId, present while running. */
  running: Record<string, string>
  toasts: Toast[]
  sidebarTab: 'personas' | 'deterministic'
  caretakerOpen: boolean
  /** The conversation currently shown in the Care Taker modal. */
  caretakerActiveChatId: string | null
  /** The conversation with a turn in flight (null when idle). */
  caretakerRunningChatId: string | null
  caretakerStream: CaretakerStream | null
  walkerOpen: boolean
  walkerActiveChatId: string | null
  walkerRunningChatId: string | null
  walkerStream: WalkerStream | null
  walkerAutonomy: WalkerAutonomy
  /** Live status of the local model server (null until first read). */
  localStatus: LocalServerStatus | null
  /** Installed llama.cpp engine builds + active tag (null until first read). */
  llamaEngines: LlamaEngineState | null
  /** In-flight engine/model downloads, keyed by DownloadProgress.id. */
  downloads: Record<string, DownloadProgress>
  /** First-run (skippable) local-LLM setup modal. */
  localSetupOpen: boolean

  /** GitHub auto-update state (mirrored from main; idle/unsupported in dev). */
  updateState: UpdateState
  /** The update popup (auto-opens once when a new version first appears). */
  updateModalOpen: boolean
  /** Version we've already auto-prompted for, so we don't re-pop the dialog (persisted). */
  updatePromptedVersion: string | null
  /** Fold a pushed/fetched updater state into the store (+ persist new prompts). */
  ingestUpdateState: (s: UpdateState) => void
  openUpdateModal: () => void
  closeUpdateModal: () => void
  /** Begin downloading the update. `restartWhenReady` installs + relaunches when done. */
  startUpdate: (restartWhenReady: boolean) => Promise<void>
  /** Quit and install a downloaded update. */
  applyUpdate: () => Promise<void>
  /** Manually re-check GitHub for a newer version. */
  checkForUpdates: () => Promise<void>

  loadLlamaEngines: () => Promise<void>
  downloadLlama: (tag: string) => Promise<void>
  setActiveLlama: (tag: string) => Promise<void>
  removeLlama: (tag: string) => Promise<void>
  openLocalSetup: () => void
  closeLocalSetup: (markSeen?: boolean) => void

  init: () => Promise<void>
  setState: (s: KennelState) => void
  pushToast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: string) => void
  setSidebarTab: (tab: 'personas' | 'deterministic') => void

  selectNode: (nodeId: string | null) => void
  checkoutNode: (nodeId: string) => Promise<void>
  openLauncher: (parentId: string, prefill?: LauncherPrefill, parkId?: string) => void
  closeLauncher: () => void

  // Parks (workflow canvases)
  openPark: (parkId: string) => void
  closePark: () => void
  createParkNode: (parentId: string, name: string, parkKind: ParkKind) => Promise<string | null>
  deletePark: (parkId: string) => Promise<void>
  saveParkSchedule: (parkId: string, cron: string, enabled: boolean) => Promise<void>
  addWorkflowStep: (
    parkId: string,
    input: Omit<CreateWorkflowNodeInput, 'position'> & { position?: { x: number; y: number } }
  ) => Promise<void>
  updateWorkflowNode: (parkId: string, nodeId: string, patch: Partial<WorkflowNode>) => Promise<void>
  deleteWorkflowNode: (parkId: string, nodeId: string) => Promise<void>
  setWorkflowNodePositions: (
    parkId: string,
    updates: { id: string; position: { x: number; y: number } }[]
  ) => void
  runWorkflow: (parkId: string, mode: WorkflowRunMode) => Promise<void>
  cancelWorkflow: (parkId: string) => Promise<void>
  openSettings: (tab?: 'providers' | 'personas' | 'local' | 'mcp') => void
  closeSettings: () => void

  saveProvider: (input: SaveProviderInput) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  switchProviderModel: (input: {
    providerId: string
    fromModel: string
    toModel: string
    scope: 'project' | 'library'
  }) => Promise<number>
  setShareParkCapabilities: (shared: boolean) => Promise<void>
  savePersona: (p: AgentPersona) => Promise<void>
  addPersonaToProject: (id: string) => Promise<void>
  removePersonaFromProject: (id: string) => Promise<void>
  deletePersonaFromLibrary: (id: string) => Promise<void>

  saveProcess: (p: DeterministicProcess) => Promise<void>
  deleteProcess: (id: string) => Promise<void>

  saveMcpServer: (server: McpServerConfig) => Promise<void>
  addMcpServerToProject: (id: string) => Promise<void>
  removeMcpServerFromProject: (id: string) => Promise<void>
  deleteMcpServerFromLibrary: (id: string) => Promise<void>
  testMcpServer: (
    server: McpServerConfig
  ) => Promise<{ ok: boolean; message: string; tools?: string[] }>

  // Care Taker
  openCaretaker: () => void
  closeCaretaker: () => void
  saveCaretaker: (config: CaretakerConfig | null) => Promise<void>
  selectCaretakerChat: (chatId: string) => void
  newCaretakerChat: () => Promise<string | null>
  deleteCaretakerChat: (chatId: string) => Promise<void>
  renameCaretakerChat: (chatId: string, title: string) => Promise<void>
  sendCaretaker: (message: string) => Promise<void>
  cancelCaretaker: () => Promise<void>
  applyCaretakerEvent: (e: CaretakerEvent) => void

  // Walker
  openWalker: () => void
  closeWalker: () => void
  saveWalker: (config: WalkerConfig | null) => Promise<void>
  setWalkerAutonomy: (a: WalkerAutonomy) => void
  selectWalkerChat: (chatId: string) => void
  newWalkerChat: () => Promise<string | null>
  deleteWalkerChat: (chatId: string) => Promise<void>
  renameWalkerChat: (chatId: string, title: string) => Promise<void>
  sendWalker: (message: string) => Promise<void>
  cancelWalker: () => Promise<void>
  applyWalkerEvent: (e: WalkerEvent) => void

  openFolder: () => Promise<void>
  openProjectPath: (path: string) => Promise<void>
  closeProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>

  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void
  setNodePositions: (updates: { id: string; position: { x: number; y: number } }[]) => void
  deleteNode: (nodeId: string) => Promise<void>

  runAgentic: (parentId: string, personaId: string, prompt: string) => Promise<void>
  runDeterministic: (parentId: string, title: string, command: string) => Promise<void>
  runProcess: (parentId: string, processId: string, inputs: Record<string, string>) => Promise<void>
  cancelRun: (nodeId: string) => Promise<void>

  applyRunEvent: (e: RunEvent) => void
  nodeById: (id: string) => CanvasNode | undefined
}

/** Persisted across restarts so a dismissed update doesn't re-pop the dialog every launch. */
const UPDATE_PROMPTED_KEY = 'kennel.updatePromptedVersion'
function readPromptedVersion(): string | null {
  try {
    return window.localStorage.getItem(UPDATE_PROMPTED_KEY)
  } catch {
    return null
  }
}

/** Fold an updater state into the store, auto-opening the popup the first time a
 *  given new version becomes available (but never re-popping it after dismissal). */
function foldUpdate(
  st: { updateModalOpen: boolean; updatePromptedVersion: string | null },
  s: UpdateState
): { updateState: UpdateState; updateModalOpen: boolean; updatePromptedVersion: string | null } {
  const v = s.info?.version ?? null
  const firstPrompt = s.phase === 'available' && v !== null && st.updatePromptedVersion !== v
  return {
    updateState: s,
    updateModalOpen: firstPrompt ? true : st.updateModalOpen,
    updatePromptedVersion: firstPrompt ? v : st.updatePromptedVersion
  }
}

/** Rebind agent-chat selection to a (newly) active project's conversations. */
function resetAgentChats(s: KennelState) {
  const walkerChat = s.walkerChats[0] ?? null
  return {
    caretakerActiveChatId: s.caretakerChats[0]?.id ?? null,
    caretakerRunningChatId: null,
    caretakerStream: null,
    walkerActiveChatId: walkerChat?.id ?? null,
    walkerRunningChatId: null,
    walkerStream: null,
    walkerAutonomy: walkerChat?.autonomy ?? s.walker?.autonomy ?? ('medium' as WalkerAutonomy)
  }
}

function spawnPosition(state: KennelState | null, parentId: string): { x: number; y: number } {
  const parent = state?.nodes.find((n) => n.id === parentId)
  const base = parent?.position ?? { x: 0, y: 0 }
  const siblings = state?.nodes.filter((n) => n.parentId === parentId) ?? []
  const offset = siblings.length * 300
  return { x: base.x - 120 + offset, y: base.y + 200 }
}

export const useKennel = create<KennelStore>((set, get) => ({
  state: EMPTY_STATE,
  ready: false,
  selectedNodeId: null,
  settingsOpen: false,
  settingsTab: 'providers',
  launcher: null,
  openParkId: null,
  logs: {},
  running: {},
  toasts: [],
  sidebarTab: 'personas',
  caretakerOpen: false,
  caretakerActiveChatId: null,
  caretakerRunningChatId: null,
  caretakerStream: null,
  walkerOpen: false,
  walkerActiveChatId: null,
  walkerRunningChatId: null,
  walkerStream: null,
  walkerAutonomy: 'medium',
  localStatus: null,
  llamaEngines: null,
  downloads: {},
  localSetupOpen: false,
  updateState: { phase: 'idle', supported: false },
  updateModalOpen: false,
  updatePromptedVersion: readPromptedVersion(),

  // Fold an updater state in; persist a newly-prompted version so a "Later"-dismissed
  // update doesn't force the dialog open again on the next launch.
  ingestUpdateState: (s) => {
    const st = get()
    const next = foldUpdate(st, s)
    if (next.updatePromptedVersion && next.updatePromptedVersion !== st.updatePromptedVersion) {
      try {
        window.localStorage.setItem(UPDATE_PROMPTED_KEY, next.updatePromptedVersion)
      } catch {
        /* private mode / quota — non-fatal */
      }
    }
    set(next)
  },
  openUpdateModal: () => set({ updateModalOpen: true }),
  closeUpdateModal: () => set({ updateModalOpen: false }),
  startUpdate: async (restartWhenReady) => {
    // Background download closes the dialog and surfaces the title-bar pill;
    // "Update now" (restartWhenReady) keeps the dialog open to show progress
    // before the app relaunches itself.
    if (!restartWhenReady) set({ updateModalOpen: false })
    try {
      await window.kennel.downloadUpdate(restartWhenReady)
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Update download failed')
    }
  },
  applyUpdate: async () => {
    try {
      await window.kennel.quitAndInstall()
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not install the update')
    }
  },
  checkForUpdates: async () => {
    try {
      get().ingestUpdateState(await window.kennel.checkForUpdates())
    } catch {
      /* surfaced via the update event */
    }
  },

  loadLlamaEngines: async () => {
    try {
      set({ llamaEngines: await window.kennel.getLlamaEngines() })
    } catch {
      /* surfaced elsewhere */
    }
  },
  downloadLlama: async (tag) => {
    try {
      const engines = await window.kennel.downloadLlamaRelease(tag)
      set({ llamaEngines: engines })
      get().pushToast('success', `llama.cpp ${tag} installed.`)
      // Refresh defaults so the panel sees the new active binary.
      void window.kennel.getLocalStatus().then((ls) => set({ localStatus: ls }))
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Engine download failed')
    }
  },
  setActiveLlama: async (tag) => {
    try {
      set({ llamaEngines: await window.kennel.setActiveLlama(tag) })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not switch engine')
    }
  },
  removeLlama: async (tag) => {
    try {
      set({ llamaEngines: await window.kennel.removeLlama(tag) })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not remove engine')
    }
  },
  openLocalSetup: () => set({ localSetupOpen: true }),
  closeLocalSetup: (markSeen = true) => {
    set({ localSetupOpen: false })
    if (markSeen) void window.kennel.setLocalSetupSeen(true)
  },

  init: async () => {
    if (!listenersBound) {
      listenersBound = true
      window.kennel.onStateChanged((next) =>
        // Reconcile openParkId: a park can vanish via a main-process state push
        // (Walker delete_node, cron, Care Taker) without the renderer's deletePark
        // action — clear it so the canvas gate, banner, and sendWalker stay consistent.
        set((st) => ({
          state: next,
          openParkId:
            st.openParkId && next.parks.some((p) => p.id === st.openParkId)
              ? st.openParkId
              : null
        }))
      )
      window.kennel.onRunEvent((e) => get().applyRunEvent(e))
      window.kennel.onCaretakerEvent((e) => get().applyCaretakerEvent(e))
      window.kennel.onWalkerEvent((e) => get().applyWalkerEvent(e))
      window.kennel.onLocalStatus((s) => set({ localStatus: s }))
      window.kennel.onDownloadProgress((p) =>
        set((st) => {
          const downloads = { ...st.downloads }
          if (p.phase === 'done' || p.phase === 'error') delete downloads[p.id]
          else downloads[p.id] = p
          return { downloads }
        })
      )
      window.kennel.onUpdateEvent((s) => get().ingestUpdateState(s))
      window.addEventListener('unhandledrejection', (ev) => {
        const msg = (ev.reason && (ev.reason.message ?? String(ev.reason))) || 'Unexpected error'
        get().pushToast('error', String(msg).replace(/^Error:\s*/, ''))
      })
    }
    const s = await window.kennel.getState()
    // If an agent run is already in flight (e.g. the window reloaded mid-run),
    // rebind to that conversation and show a live indicator until events resume.
    const cRunning = s.caretakerRunningChatId
    const wRunning = s.walkerRunningChatId
    const walkerActive = wRunning ?? s.walkerChats[0]?.id ?? null
    const walkerChat = s.walkerChats.find((c) => c.id === walkerActive) ?? null
    set({
      state: s,
      ready: true,
      caretakerActiveChatId: cRunning ?? s.caretakerChats[0]?.id ?? null,
      caretakerRunningChatId: cRunning,
      caretakerStream: cRunning ? { text: '', thinking: false, tools: [] } : null,
      walkerActiveChatId: walkerActive,
      walkerRunningChatId: wRunning,
      walkerStream: wRunning ? { text: '', thinking: false, tools: [] } : null
    })
    if (s.project) set({ selectedNodeId: s.project.activeNodeId })
    set({ walkerAutonomy: walkerChat?.autonomy ?? s.walker?.autonomy ?? 'medium' })
    void window.kennel.getLocalStatus().then((ls) => set({ localStatus: ls }))
    // Sync any update state the main process already learned before we subscribed.
    void window.kennel.getUpdateState().then((u) => get().ingestUpdateState(u))
    // Load installed engines; on a fresh machine with none installed, prompt the
    // (skippable) first-run local-LLM setup unless it's already been dismissed.
    void (async () => {
      const [engines, seen] = await Promise.all([
        window.kennel.getLlamaEngines(),
        window.kennel.getLocalSetupSeen()
      ])
      set({ llamaEngines: engines })
      if (!seen && engines.installs.length === 0) set({ localSetupOpen: true })
    })()
  },

  setState: (s) => set({ state: s }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  pushToast: (kind, message) => {
    const id = nextId()
    set((st) => ({ toasts: [...st.toasts, { id, kind, message }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500)
  },
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  checkoutNode: async (nodeId) => {
    try {
      const s = await window.kennel.selectNode(nodeId)
      set({ state: s, selectedNodeId: nodeId })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not switch to this state')
    }
  },

  openLauncher: (parentId, prefill, parkId) => set({ launcher: { parentId, prefill, parkId } }),
  closeLauncher: () => set({ launcher: null }),

  // ── Parks ───────────────────────────────────────────────────────────────────
  openPark: (parkId) => set({ openParkId: parkId, launcher: null }),
  closePark: () => set({ openParkId: null, launcher: null }),

  createParkNode: async (parentId, name, parkKind) => {
    try {
      const position = spawnPosition(get().state, parentId)
      const before = new Set((get().state?.parks ?? []).map((p) => p.id))
      const s = await window.kennel.createPark({ parentNodeId: parentId, name, parkKind, position })
      set({ state: s })
      return s.parks.find((p) => !before.has(p.id))?.id ?? null
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not create park')
      return null
    }
  },
  deletePark: async (parkId) => {
    try {
      const s = await window.kennel.deletePark(parkId)
      set((st) => ({ state: s, openParkId: st.openParkId === parkId ? null : st.openParkId }))
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not delete park')
    }
  },
  saveParkSchedule: async (parkId, cron, enabled) => {
    try {
      set({ state: await window.kennel.saveParkSchedule(parkId, cron, enabled) })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not save schedule')
    }
  },
  addWorkflowStep: async (parkId, input) => {
    try {
      const park = get().state?.parks.find((p) => p.id === parkId)
      let position = input.position
      if (!position && park) {
        const parent = park.nodes.find((n) => n.id === input.parentId)
        const base = parent?.position ?? { x: 0, y: 0 }
        const siblings = park.nodes.filter((n) => n.parentId === input.parentId).length
        position = { x: base.x - 120 + siblings * 280, y: base.y + 200 }
      }
      const s = await window.kennel.addWorkflowNode(parkId, {
        ...input,
        position: position ?? { x: 0, y: 0 }
      })
      set({ state: s })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not add step')
      throw e
    }
  },
  updateWorkflowNode: async (parkId, nodeId, patch) => {
    try {
      set({ state: await window.kennel.updateWorkflowNode(parkId, nodeId, patch) })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not update step')
    }
  },
  deleteWorkflowNode: async (parkId, nodeId) => {
    try {
      set({ state: await window.kennel.deleteWorkflowNode(parkId, nodeId) })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not delete step')
    }
  },
  setWorkflowNodePositions: (parkId, updates) => {
    const s = get().state
    if (s) {
      const byId = new Map(updates.map((u) => [u.id, u.position]))
      set({
        state: {
          ...s,
          parks: s.parks.map((p) =>
            p.id === parkId
              ? { ...p, nodes: p.nodes.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n)) }
              : p
          )
        }
      })
    }
    void window.kennel.setWorkflowNodePositions(parkId, updates)
  },
  runWorkflow: async (parkId, mode) => {
    try {
      await window.kennel.runWorkflow(parkId, mode)
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Workflow failed to start')
    }
  },
  cancelWorkflow: async (parkId) => {
    await window.kennel.cancelWorkflow(parkId)
  },
  openSettings: (tab) => set({ settingsOpen: true, settingsTab: tab ?? get().settingsTab }),
  closeSettings: () => set({ settingsOpen: false }),

  saveProvider: async (input) => set({ state: await window.kennel.saveProvider(input) }),
  deleteProvider: async (id) => set({ state: await window.kennel.deleteProvider(id) }),
  switchProviderModel: async (input) => {
    const { state, switched } = await window.kennel.switchProviderModel(input)
    set({ state })
    return switched
  },
  setShareParkCapabilities: async (shared) =>
    set({ state: await window.kennel.setShareParkCapabilities(shared) }),
  savePersona: async (p) => set({ state: await window.kennel.savePersona(p) }),
  addPersonaToProject: async (id) => set({ state: await window.kennel.addPersonaToProject(id) }),
  removePersonaFromProject: async (id) =>
    set({ state: await window.kennel.removePersonaFromProject(id) }),
  deletePersonaFromLibrary: async (id) =>
    set({ state: await window.kennel.deletePersonaFromLibrary(id) }),

  saveProcess: async (p) => set({ state: await window.kennel.saveProcess(p) }),
  deleteProcess: async (id) => set({ state: await window.kennel.deleteProcess(id) }),

  saveMcpServer: async (server) => set({ state: await window.kennel.saveMcpServer(server) }),
  addMcpServerToProject: async (id) =>
    set({ state: await window.kennel.addMcpServerToProject(id) }),
  removeMcpServerFromProject: async (id) =>
    set({ state: await window.kennel.removeMcpServerFromProject(id) }),
  deleteMcpServerFromLibrary: async (id) =>
    set({ state: await window.kennel.deleteMcpServerFromLibrary(id) }),
  testMcpServer: (server) => window.kennel.testMcpServer(server),

  openCaretaker: () =>
    set((st) => {
      const chats = st.state?.caretakerChats ?? []
      const active = chats.some((c) => c.id === st.caretakerActiveChatId)
        ? st.caretakerActiveChatId
        : (chats[0]?.id ?? null)
      return { caretakerOpen: true, caretakerActiveChatId: active }
    }),
  closeCaretaker: () => set({ caretakerOpen: false }),
  saveCaretaker: async (config) => set({ state: await window.kennel.saveCaretaker(config) }),

  selectCaretakerChat: (chatId) => set({ caretakerActiveChatId: chatId }),

  newCaretakerChat: async () => {
    try {
      const { chatId, state } = await window.kennel.createCaretakerChat()
      set({ state, caretakerActiveChatId: chatId })
      return chatId
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not start a conversation')
      return null
    }
  },

  deleteCaretakerChat: async (chatId) => {
    if (get().caretakerRunningChatId === chatId) {
      get().pushToast('error', 'Stop this conversation before deleting it.')
      return
    }
    try {
      const state = await window.kennel.deleteCaretakerChat(chatId)
      set((st) => ({
        state,
        caretakerActiveChatId:
          st.caretakerActiveChatId === chatId
            ? (state.caretakerChats[0]?.id ?? null)
            : st.caretakerActiveChatId
      }))
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not delete conversation')
    }
  },

  renameCaretakerChat: async (chatId, title) => {
    try {
      set({ state: await window.kennel.renameCaretakerChat(chatId, title) })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not rename conversation')
    }
  },

  sendCaretaker: async (message) => {
    if (get().caretakerRunningChatId) return // a turn is already in flight
    let chatId = get().caretakerActiveChatId
    if (!chatId) {
      chatId = await get().newCaretakerChat()
      if (!chatId) return
    }
    set({ caretakerRunningChatId: chatId, caretakerStream: { text: '', thinking: false, tools: [] } })
    try {
      await window.kennel.runCaretaker({ chatId, message })
    } catch (e: any) {
      const msg = e?.message ?? 'Care Taker failed'
      get().pushToast('error', msg)
      set({ caretakerRunningChatId: null, caretakerStream: null })
    }
  },

  cancelCaretaker: async () => {
    await window.kennel.cancelCaretaker()
  },

  applyCaretakerEvent: (e) => {
    set((st) => {
      const stream = st.caretakerStream
        ? { ...st.caretakerStream, tools: [...st.caretakerStream.tools] }
        : { text: '', thinking: false, tools: [] }
      switch (e.type) {
        case 'start':
          return {
            caretakerRunningChatId: e.chatId,
            caretakerStream: { text: '', thinking: false, tools: [] }
          }
        case 'assistant':
          stream.text += e.text
          stream.thinking = false
          return { caretakerStream: stream }
        case 'thinking':
          stream.thinking = true
          return { caretakerStream: stream }
        case 'status':
          stream.status = e.text
          return { caretakerStream: stream }
        case 'tool_call':
          stream.tools.push({ callId: e.callId, tool: e.tool })
          return { caretakerStream: stream }
        case 'tool_result': {
          const i = stream.tools.findIndex((t) => t.callId === e.callId && t.ok === undefined)
          if (i >= 0) stream.tools[i] = { ...stream.tools[i], ok: e.ok }
          return { caretakerStream: stream }
        }
        // The transcript is owned by main and arrives via state; just clear the
        // live stream and the running marker. (Both 'done' and 'error'.)
        case 'done':
        case 'error':
          return { caretakerStream: null, caretakerRunningChatId: null }
        default:
          return {}
      }
    })
  },

  // ── Walker ─────────────────────────────────────────────────────────────────
  openWalker: () =>
    set((st) => {
      const chats = st.state?.walkerChats ?? []
      const active = chats.find((c) => c.id === st.walkerActiveChatId) ?? chats[0] ?? null
      return {
        walkerOpen: true,
        walkerActiveChatId: active?.id ?? null,
        walkerAutonomy: active?.autonomy ?? st.state?.walker?.autonomy ?? st.walkerAutonomy
      }
    }),
  closeWalker: () => set({ walkerOpen: false }),
  saveWalker: async (config) => {
    // Partial saves (e.g. provider/model from the config row) must not clobber
    // the persisted autonomy — merge over the prior config and stamp the live
    // picker value so the autonomy round-trips across restarts.
    const next = config
      ? { ...get().state?.walker, ...config, autonomy: get().walkerAutonomy }
      : null
    set({ state: await window.kennel.saveWalker(next) })
  },
  setWalkerAutonomy: (a) => {
    set({ walkerAutonomy: a })
    // Persist the choice immediately (don't wait for a task to be run).
    const w = get().state?.walker
    if (w) void get().saveWalker({ providerId: w.providerId, model: w.model })
  },

  selectWalkerChat: (chatId) =>
    set((st) => {
      const chat = st.state?.walkerChats.find((c) => c.id === chatId)
      return {
        walkerActiveChatId: chatId,
        walkerAutonomy: chat?.autonomy ?? st.walkerAutonomy
      }
    }),

  newWalkerChat: async () => {
    try {
      const { chatId, state } = await window.kennel.createWalkerChat()
      set({ state, walkerActiveChatId: chatId })
      return chatId
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not start a conversation')
      return null
    }
  },

  deleteWalkerChat: async (chatId) => {
    if (get().walkerRunningChatId === chatId) {
      get().pushToast('error', 'Stop this task before deleting the conversation.')
      return
    }
    try {
      const state = await window.kennel.deleteWalkerChat(chatId)
      set((st) => ({
        state,
        walkerActiveChatId:
          st.walkerActiveChatId === chatId
            ? (state.walkerChats[0]?.id ?? null)
            : st.walkerActiveChatId
      }))
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not delete conversation')
    }
  },

  renameWalkerChat: async (chatId, title) => {
    try {
      set({ state: await window.kennel.renameWalkerChat(chatId, title) })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not rename conversation')
    }
  },

  sendWalker: async (message) => {
    if (get().walkerRunningChatId) return // a task is already in flight
    let chatId = get().walkerActiveChatId
    if (!chatId) {
      chatId = await get().newWalkerChat()
      if (!chatId) return
    }
    const autonomy = get().walkerAutonomy
    // If a Park is open, the Walker builds & runs THAT Park's workflow instead of
    // spawning nodes on the main canvas.
    const parkId = get().openParkId ?? undefined
    set({ walkerRunningChatId: chatId, walkerStream: { text: '', thinking: false, tools: [] } })
    try {
      await window.kennel.runWalker({ chatId, message, autonomy, parkId })
    } catch (e: any) {
      const msg = e?.message ?? 'Walker failed'
      get().pushToast('error', msg)
      set({ walkerRunningChatId: null, walkerStream: null })
    }
  },

  cancelWalker: async () => {
    await window.kennel.cancelWalker()
  },

  applyWalkerEvent: (e) => {
    // A spawned node should surface on the canvas immediately.
    if (e.type === 'spawned') {
      set({ selectedNodeId: e.nodeId })
      return
    }
    set((st) => {
      const stream = st.walkerStream
        ? { ...st.walkerStream, tools: [...st.walkerStream.tools] }
        : { text: '', thinking: false, tools: [] }
      switch (e.type) {
        case 'start':
          return {
            walkerRunningChatId: e.chatId,
            walkerStream: { text: '', thinking: false, tools: [] }
          }
        case 'assistant':
          stream.text += e.text
          stream.thinking = false
          return { walkerStream: stream }
        case 'thinking':
          stream.thinking = true
          return { walkerStream: stream }
        case 'status':
          stream.status = e.text
          return { walkerStream: stream }
        case 'tool_call':
          stream.tools.push({ callId: e.callId, tool: e.tool })
          return { walkerStream: stream }
        case 'tool_result': {
          const i = stream.tools.findIndex((t) => t.callId === e.callId && t.ok === undefined)
          if (i >= 0) stream.tools[i] = { ...stream.tools[i], ok: e.ok }
          return { walkerStream: stream }
        }
        // The transcript is owned by main and arrives via state; just clear the
        // live stream and the running marker. (Both 'done' and 'error'.)
        case 'done':
        case 'error':
          return { walkerStream: null, walkerRunningChatId: null }
        default:
          return {}
      }
    })
  },

  openFolder: async () => {
    const path = await window.kennel.pickFolder()
    if (path) await get().openProjectPath(path)
  },
  openProjectPath: async (path) => {
    try {
      const s = await window.kennel.openProject(path)
      // Conversations are per-project: rebind the active chats to the new project.
      set({
        state: s,
        selectedNodeId: s.project?.activeNodeId ?? null,
        logs: {},
        openParkId: null,
        ...resetAgentChats(s)
      })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not open project')
    }
  },
  closeProject: async () => {
    try {
      const s = await window.kennel.closeProject()
      set({ state: s, selectedNodeId: null, logs: {}, openParkId: null, ...resetAgentChats(s) })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not close project')
    }
  },
  removeProject: async (id) => {
    try {
      const prevProjectId = get().state?.project?.id
      const s = await window.kennel.removeProject(id)
      // Only rebind agent chats if the active project actually changed.
      const projectChanged = s.project?.id !== prevProjectId
      set((st) => ({
        state: s,
        selectedNodeId: s.project ? st.selectedNodeId : null,
        logs: s.project ? st.logs : {},
        ...(projectChanged ? resetAgentChats(s) : {})
      }))
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not remove project')
    }
  },

  updateNodePosition: (nodeId, position) => {
    const s = get().state
    if (s) {
      set({
        state: {
          ...s,
          nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n))
        }
      })
    }
    void window.kennel.updateNodePosition(nodeId, position)
  },

  setNodePositions: (updates) => {
    const s = get().state
    if (s) {
      const byId = new Map(updates.map((u) => [u.id, u.position]))
      set({
        state: {
          ...s,
          nodes: s.nodes.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n))
        }
      })
    }
    void window.kennel.updateNodePositions(updates)
  },

  deleteNode: async (nodeId) => {
    try {
      const s = await window.kennel.deleteNode(nodeId)
      set((st) => ({
        state: s,
        selectedNodeId: st.selectedNodeId === nodeId ? null : st.selectedNodeId
      }))
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not delete node')
    }
  },

  runAgentic: async (parentId, personaId, prompt) => {
    try {
      const position = spawnPosition(get().state, parentId)
      const { nodeId } = await window.kennel.runAgentic({
        parentNodeId: parentId,
        personaId,
        prompt,
        position
      })
      set({ selectedNodeId: nodeId })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not start run')
      throw e
    }
  },

  runDeterministic: async (parentId, title, command) => {
    try {
      const position = spawnPosition(get().state, parentId)
      const { nodeId } = await window.kennel.runDeterministic({
        parentNodeId: parentId,
        title,
        command,
        position
      })
      set({ selectedNodeId: nodeId })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not start task')
      throw e
    }
  },

  runProcess: async (parentId, processId, inputs) => {
    try {
      const position = spawnPosition(get().state, parentId)
      const { nodeId } = await window.kennel.runProcess({
        parentNodeId: parentId,
        processId,
        inputs,
        position
      })
      set({ selectedNodeId: nodeId })
    } catch (e: any) {
      get().pushToast('error', e?.message ?? 'Could not start process')
      throw e
    }
  },

  cancelRun: async (nodeId) => {
    const runId = get().running[nodeId]
    if (runId) await window.kennel.cancelRun(runId)
  },

  applyRunEvent: (e) => {
    set((st) => {
      const logs = { ...st.logs }
      const arr = logs[e.nodeId] ? [...logs[e.nodeId]] : []
      const last = arr[arr.length - 1]
      const running = { ...st.running }

      switch (e.type) {
        case 'start':
          running[e.nodeId] = e.runId
          logs[e.nodeId] = []
          return { logs, running }
        case 'status':
          arr.push({ id: nextId(), kind: 'status', text: e.text })
          break
        case 'thinking':
          if (last && last.kind === 'thinking')
            arr[arr.length - 1] = { ...last, text: last.text + e.text }
          else arr.push({ id: nextId(), kind: 'thinking', text: e.text })
          break
        case 'assistant':
          if (last && last.kind === 'assistant')
            arr[arr.length - 1] = { ...last, text: last.text + e.text }
          else arr.push({ id: nextId(), kind: 'assistant', text: e.text })
          break
        case 'tool_call':
          arr.push({
            id: nextId(),
            kind: 'tool',
            callId: e.callId,
            tool: e.tool,
            input: e.input
          })
          break
        case 'tool_result': {
          const idx = [...arr].reverse().findIndex((l) => l.kind === 'tool' && l.callId === e.callId)
          if (idx >= 0) {
            const realIdx = arr.length - 1 - idx
            const entry = arr[realIdx]
            if (entry.kind === 'tool') {
              arr[realIdx] = { ...entry, ok: e.ok, preview: e.preview }
            }
          }
          break
        }
        case 'output':
          if (last && last.kind === 'output' && last.stream === e.stream)
            arr[arr.length - 1] = { ...last, text: last.text + e.text }
          else arr.push({ id: nextId(), kind: 'output', stream: e.stream, text: e.text })
          break
        case 'error':
          arr.push({ id: nextId(), kind: 'error', text: e.message })
          delete running[e.nodeId]
          break
        case 'done':
          arr.push({ id: nextId(), kind: 'done', text: e.node.summary ?? 'Done' })
          delete running[e.nodeId]
          break
      }
      logs[e.nodeId] = arr
      return { logs, running }
    })
  },

  nodeById: (id) => get().state?.nodes.find((n) => n.id === id)
}))
