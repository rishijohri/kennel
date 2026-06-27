import { basename, join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import type {
  AgentPersona,
  CanvasNode,
  CreateAgenticRunInput,
  CreateDeterministicRunInput,
  Project,
  SaveProviderInput
} from '@shared/types'
import { store } from './services/store'
import { sendState } from './services/broadcast'
import {
  checkoutCommit,
  ensureRepo,
  listTree,
  nameStatus,
  pinNode,
  showFile,
  showFileStrict,
  unpinNode
} from './services/git'
import { buildTree } from './services/fstree'
import {
  cancelRun,
  isBusy,
  startAgenticRun,
  startDeterministicRun,
  startProcessRun
} from './agent/run-manager'
import { cancelCaretaker, isCaretakerBusy, runCaretaker } from './agent/caretaker'
import { cancelWalker, isWalkerBusy, runWalker } from './agent/walker'
import {
  addWorkflowNode,
  createPark,
  deletePark,
  deleteWorkflowNode,
  setWorkflowNodePositions,
  updateWorkflowNode
} from './services/parks'
import { cancelWorkflow, runWorkflow } from './agent/workflow-runner'
import { HF_ROUTER_URL } from './agent/provider-runner'
import {
  cancelCopilotSetup,
  getCopilotStatus,
  installCopilot,
  loginCopilot
} from './services/copilot-cli'
import { sendCopilotSetup } from './services/broadcast'
import { getNodeActivity } from './services/activity-log'
import { discardParkRuns, workspaceFile, workspaceTree } from './services/workflow-workspace'
import { deleteCanvasNode } from './services/node-ops'
import { dropMcpConnection, testMcpServer } from './services/mcp'
import { getDefaults, getStatus, startServer, stopServer } from './services/local-llm'
import {
  downloadRelease,
  engineState,
  listReleases,
  removeBuild,
  setActive
} from './services/llama-manager'
import { downloadModel, listFiles, listModels } from './services/hf-models'
import type { HfModelFile } from '@shared/types'
import { isWakeMode, setWakeMode } from './services/wake'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  quitAndInstall
} from './services/updater'
import type {
  CaretakerConfig,
  CreateWorkflowNodeInput,
  DeterministicProcess,
  LocalModel,
  LocalServerConfig,
  McpServerConfig,
  ParkKind,
  RunProcessInput,
  WalkerAutonomy,
  WalkerConfig,
  WorkflowNode,
  WorkflowRunMode
} from '@shared/types'

/**
 * List the models a provider exposes (used to test connectivity AND populate the
 * model dropdowns). Returns a friendly message plus the model ids on success.
 */
async function listProviderModels(
  provider: { kind: string; baseUrl?: string; project?: string; location?: string; defaultModel?: string },
  apiKey: string
): Promise<{ ok: boolean; message: string; models?: string[] }> {
  try {
    if (provider.kind === 'copilot') {
      // Keyless: "testing" = probe the CLI's readiness + offered models.
      const status = await getCopilotStatus()
      if (!status.installed) {
        return { ok: false, message: 'GitHub Copilot CLI is not installed. Use “Install CLI”.' }
      }
      if (!status.signedIn) {
        return { ok: false, message: `${status.version ?? 'Copilot CLI'} installed — not signed in. Use “Sign in”.` }
      }
      return {
        ok: true,
        message: `${status.version ?? 'GitHub Copilot CLI'}${status.login ? ` · signed in as ${status.login}` : ' · signed in'}.`,
        models: status.models
      }
    }
    if (provider.kind === 'anthropic') {
      const client = new Anthropic({ apiKey })
      const res = await client.models.list({ limit: 50 })
      return { ok: true, message: 'Connected to Claude.', models: res.data.map((m) => m.id) }
    }
    if (provider.kind === 'google' || provider.kind === 'google-vertex') {
      const ai =
        provider.kind === 'google-vertex'
          ? new GoogleGenAI({
              vertexai: true,
              apiKey: apiKey || undefined,
              project: provider.project || undefined,
              location: provider.location || undefined
            })
          : new GoogleGenAI({ apiKey })
      const label =
        provider.kind === 'google-vertex' ? 'Connected to Vertex AI.' : 'Connected to Google AI Studio.'
      try {
        const pager: any = await ai.models.list()
        const models: string[] = []
        for await (const m of pager) {
          // Keep only models that can generate content (skip embedding/other).
          const actions: string[] = m?.supportedActions ?? m?.supportedGenerationMethods ?? []
          if (m?.name && (actions.length === 0 || actions.includes('generateContent'))) {
            models.push(String(m.name).replace(/^models\//, ''))
          }
          if (models.length >= 80) break
        }
        return { ok: true, message: label, models }
      } catch {
        // Fall back to a tiny generate to confirm credentials + endpoint.
        await ai.models.generateContent({
          model: provider.defaultModel || 'gemini-2.5-flash',
          contents: 'ping'
        })
        return { ok: true, message: label, models: [] }
      }
    }
    // openai + openai-compatible + huggingface — all OpenAI-compatible. HF uses the
    // unified router (token-authed); the rest use the configured baseUrl (or OpenAI).
    const baseURL = provider.kind === 'huggingface' ? HF_ROUTER_URL : provider.baseUrl
    const client = new OpenAI({ apiKey: apiKey || 'not-needed', baseURL })
    const res = await client.models.list()
    const models = res.data.map((m) => m.id).slice(0, 100)
    return {
      ok: true,
      message:
        provider.kind === 'huggingface'
          ? 'Connected to Hugging Face Inference.'
          : provider.kind === 'openai-compatible'
            ? `Connected to ${provider.baseUrl}.`
            : 'Connected to OpenAI.',
      models
    }
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Connection failed.' }
  }
}

/**
 * Guard user-initiated runs against the single working tree being claimed by an
 * agent session. The Walker/Care Taker call the run/workflow functions directly
 * (not through IPC), so guarding here blocks only the renderer (the user) from
 * racing an agent — it never self-blocks the agent. Mirrors the Walker/Care
 * Taker guards already on openProject/closeProject/removeProject.
 */
function assertNoAgentBusy(): void {
  if (isWalkerBusy() || isCaretakerBusy()) {
    throw new Error(
      'The Walker or Care Taker is working right now — stop it before starting a manual run.'
    )
  }
}

export function registerIpc(): void {
  ipcMain.handle('kennel:getState', () => store.getState())

  // ── Providers ──────────────────────────────────────────────────────────
  ipcMain.handle('kennel:saveProvider', (_e, input: SaveProviderInput) => {
    store.upsertProvider(input.provider, input.apiKey)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:deleteProvider', (_e, id: string) => {
    store.deleteProvider(id)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle(
    'kennel:switchProviderModel',
    (
      _e,
      input: { providerId: string; fromModel: string; toModel: string; scope: 'project' | 'library' }
    ) => {
      const switched = store.switchProviderModel(
        input.providerId,
        input.fromModel,
        input.toModel,
        input.scope
      )
      const state = store.getState()
      sendState(state)
      return { state, switched }
    }
  )

  ipcMain.handle('kennel:testProvider', async (_e, id: string) => {
    const provider = store.getProvider(id)
    if (!provider) return { ok: false, message: 'Provider not found.' }
    const apiKey = store.getApiKey(id) ?? ''
    const res = await listProviderModels(provider, apiKey)
    // On success, cache the discovered models and adopt a default if none is set,
    // so model pickers everywhere can offer a dropdown instead of free text.
    if (res.ok && res.models && res.models.length) {
      store.setProviderModels(id, res.models)
      sendState(store.getState())
    }
    return res
  })

  // ── GitHub Copilot CLI (keyless provider setup) ───────────────────────────
  ipcMain.handle('kennel:getCopilotStatus', () => getCopilotStatus())
  ipcMain.handle('kennel:installCopilot', () => installCopilot(sendCopilotSetup))
  ipcMain.handle('kennel:loginCopilot', () => loginCopilot(sendCopilotSetup))
  ipcMain.handle('kennel:cancelCopilotSetup', () => cancelCopilotSetup())

  // ── Personas (library + per-project membership) ───────────────────────────
  ipcMain.handle('kennel:savePersona', (_e, persona: AgentPersona) => {
    store.upsertPersona(persona)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:addPersonaToProject', (_e, id: string) => {
    store.addPersonaToProject(id)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:removePersonaFromProject', (_e, id: string) => {
    store.removePersonaFromProject(id)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:deletePersonaFromLibrary', (_e, id: string) => {
    store.deletePersonaFromLibrary(id)
    const s = store.getState()
    sendState(s)
    return s
  })

  // ── Deterministic processes ──────────────────────────────────────────────
  ipcMain.handle('kennel:saveProcess', (_e, process: DeterministicProcess) => {
    store.upsertProcess(process)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:deleteProcess', (_e, id: string) => {
    store.deleteProcess(id)
    const s = store.getState()
    sendState(s)
    return s
  })

  // ── MCP servers (store + per-project membership) ─────────────────────────────
  ipcMain.handle('kennel:saveMcpServer', (_e, server: McpServerConfig) => {
    store.upsertMcpServer(server)
    dropMcpConnection(server.id) // reconnect with the new config on next use
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:addMcpServerToProject', (_e, id: string) => {
    store.addMcpServerToProject(id)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:removeMcpServerFromProject', (_e, id: string) => {
    store.removeMcpServerFromProject(id)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:deleteMcpServerFromLibrary', (_e, id: string) => {
    store.deleteMcpServerFromLibrary(id)
    dropMcpConnection(id)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:testMcpServer', (_e, server: McpServerConfig) => testMcpServer(server))

  ipcMain.handle('kennel:getMcpServerSecrets', (_e, id: string) => store.getMcpServerSecrets(id))

  // ── Care Taker ────────────────────────────────────────────────────────────
  ipcMain.handle('kennel:saveCaretaker', (_e, config: CaretakerConfig | null) => {
    store.setCaretaker(config)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:createCaretakerChat', () => {
    const chat = store.createChat('caretaker')
    if (!chat) throw new Error('Open a project before starting a conversation.')
    const state = store.getState()
    sendState(state)
    return { chatId: chat.id, state }
  })

  ipcMain.handle('kennel:deleteCaretakerChat', (_e, chatId: string) => {
    store.deleteChat('caretaker', chatId)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:renameCaretakerChat', (_e, chatId: string, title: string) => {
    store.renameChat('caretaker', chatId, title)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:runCaretaker', (_e, input: { chatId: string; message: string }) =>
    runCaretaker(input)
  )

  ipcMain.handle('kennel:cancelCaretaker', () => cancelCaretaker())

  // ── Walker ────────────────────────────────────────────────────────────────
  ipcMain.handle('kennel:saveWalker', (_e, config: WalkerConfig | null) => {
    store.setWalker(config)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:createWalkerChat', () => {
    const chat = store.createChat('walker')
    if (!chat) throw new Error('Open a project before starting a conversation.')
    const state = store.getState()
    sendState(state)
    return { chatId: chat.id, state }
  })

  ipcMain.handle('kennel:deleteWalkerChat', (_e, chatId: string) => {
    store.deleteChat('walker', chatId)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:renameWalkerChat', (_e, chatId: string, title: string) => {
    store.renameChat('walker', chatId, title)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle(
    'kennel:runWalker',
    (_e, input: { chatId: string; message: string; autonomy: WalkerAutonomy; parkId?: string }) =>
      runWalker(input)
  )

  ipcMain.handle('kennel:cancelWalker', () => cancelWalker())

  // ── Project ───────────────────────────────────────────────────────────────
  ipcMain.handle('kennel:pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: 'Open a project folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle('kennel:openProject', async (_e, path: string) => {
    const current = store.getProject()
    if (current && current.path === path) {
      // Already the active project — restore its active node into the working
      // tree (unless a run currently owns it).
      if (!isBusy()) {
        const active = store.getNode(current.activeNodeId) ?? store.getNode(current.rootNodeId)
        if (active) await checkoutCommit(path, active.commit)
      }
      const s = store.getState()
      sendState(s)
      return s
    }
    if (isBusy()) throw new Error('Finish the current run before switching projects.')
    if (isWalkerBusy() || isCaretakerBusy()) {
      throw new Error('Stop the Walker / Care Taker before switching projects.')
    }

    // A previously-opened project at this path? Re-activate it with its full
    // canvas history preserved, and restore its working tree.
    const known = store.getProjectByPath(path)
    if (known) {
      store.setActiveProject(known.id)
      const active = store.getNode(known.activeNodeId) ?? store.getNode(known.rootNodeId)
      if (active) await checkoutCommit(path, active.commit)
      const s = store.getState()
      sendState(s)
      return s
    }

    // Scaffold a core-memory file so the "edit core memory" permission has a
    // real target and agents have a place to persist durable context.
    const kennelMd = join(path, 'KENNEL.md')
    if (!existsSync(kennelMd)) {
      writeFileSync(
        kennelMd,
        `# Kennel core memory\n\n` +
          `Durable, project-wide context for agents working in this codebase.\n` +
          `Only personas with the "edit core memory" permission may modify this file.\n\n` +
          `## Conventions\n\n- \n\n## Architecture notes\n\n- \n`,
        'utf8'
      )
    }

    const rootCommit = await ensureRepo(path)
    const rootId = randomUUID()
    const rootNode: CanvasNode = {
      id: rootId,
      parentId: null,
      commit: rootCommit,
      title: basename(path),
      kind: 'root',
      status: 'done',
      summary: 'Initial codebase',
      createdAt: Date.now(),
      position: { x: 0, y: 0 }
    }
    await pinNode(path, rootId, rootCommit)

    const project: Project = {
      id: randomUUID(),
      name: basename(path),
      path,
      rootNodeId: rootId,
      activeNodeId: rootId,
      createdAt: Date.now()
    }
    store.addProject(project, [rootNode])
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:closeProject', () => {
    // The run owns the single working tree and writes back to the active project
    // on finish, so don't close out from under it.
    if (isBusy()) throw new Error('Finish the current run before closing the project.')
    if (isWalkerBusy() || isCaretakerBusy()) {
      throw new Error('Stop the Walker / Care Taker before closing the project.')
    }
    store.closeActiveProject()
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:removeProject', async (_e, id: string) => {
    const isActive = store.getProject()?.id === id
    if (isActive && (isBusy() || isWalkerBusy() || isCaretakerBusy())) {
      throw new Error('Finish the current run before removing this project.')
    }
    const removed = store.removeProject(id)
    // Unpin the project's node refs so its commits are no longer retained.
    if (removed) {
      for (const n of removed.nodes) await unpinNode(removed.project.path, n.id).catch(() => {})
    }
    const s = store.getState()
    sendState(s)
    return s
  })

  // ── Nodes ─────────────────────────────────────────────────────────────────
  ipcMain.handle('kennel:selectNode', async (_e, nodeId: string) => {
    const project = store.getProject()
    const node = store.getNode(nodeId)
    // Don't touch the working tree while an agent run owns it.
    if (project && node && !isBusy()) {
      await checkoutCommit(project.path, node.commit)
      store.setActiveNode(nodeId)
    }
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:setFocusedNode', (_e, nodeId: string | null) => {
    store.setFocusedNode(nodeId)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle(
    'kennel:updateNodePosition',
    (_e, nodeId: string, position: { x: number; y: number }) => {
      store.patchNode(nodeId, { position })
    }
  )

  ipcMain.handle(
    'kennel:updateNodePositions',
    (_e, updates: { id: string; position: { x: number; y: number } }[]) => {
      store.patchPositions(updates)
    }
  )

  // ── Parks (workflow canvases) ──────────────────────────────────────────────
  ipcMain.handle(
    'kennel:createPark',
    (_e, input: { parentNodeId: string; name: string; parkKind: ParkKind; position: { x: number; y: number } }) => {
      createPark(input)
      const s = store.getState()
      sendState(s)
      return s
    }
  )

  ipcMain.handle('kennel:deletePark', async (_e, parkId: string) => {
    if (isBusy()) throw new Error('Finish the current run before deleting this park.')
    await deletePark(parkId)
    await discardParkRuns(parkId).catch(() => {})
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle('kennel:setShareParkCapabilities', (_e, shared: boolean) => {
    store.setShareParkCapabilities(shared)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle(
    'kennel:saveParkSchedule',
    (_e, parkId: string, cron: string, enabled: boolean) => {
      store.patchPark(parkId, { cron, scheduleEnabled: enabled })
      const s = store.getState()
      sendState(s)
      return s
    }
  )

  ipcMain.handle('kennel:addWorkflowNode', (_e, parkId: string, node: CreateWorkflowNodeInput) => {
    addWorkflowNode(parkId, node)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle(
    'kennel:updateWorkflowNode',
    (_e, parkId: string, nodeId: string, patch: Partial<WorkflowNode>) => {
      updateWorkflowNode(parkId, nodeId, patch)
      const s = store.getState()
      sendState(s)
      return s
    }
  )

  ipcMain.handle('kennel:deleteWorkflowNode', (_e, parkId: string, nodeId: string) => {
    deleteWorkflowNode(parkId, nodeId)
    const s = store.getState()
    sendState(s)
    return s
  })

  ipcMain.handle(
    'kennel:setWorkflowNodePositions',
    (_e, parkId: string, updates: { id: string; position: { x: number; y: number } }[]) => {
      setWorkflowNodePositions(parkId, updates)
    }
  )

  ipcMain.handle('kennel:runWorkflow', (_e, parkId: string, mode: WorkflowRunMode) => {
    assertNoAgentBusy()
    return runWorkflow(parkId, 'manual', mode)
  })
  ipcMain.handle('kennel:cancelWorkflow', (_e, parkId: string) => cancelWorkflow(parkId))
  ipcMain.handle('kennel:getRunWorkspaceTree', (_e, parkId: string, runId: string) =>
    workspaceTree(parkId, runId)
  )
  ipcMain.handle('kennel:getRunWorkspaceFile', (_e, parkId: string, runId: string, relPath: string) =>
    workspaceFile(parkId, runId, relPath)
  )

  ipcMain.handle('kennel:deleteNode', async (_e, nodeId: string) => {
    // A delete may re-checkout the working tree; never do that during a run.
    if (isBusy()) throw new Error('Cannot delete a node while a run is in progress.')
    await deleteCanvasNode(nodeId) // also drops the deleted subtree's activity logs
    const s = store.getState()
    sendState(s)
    return s
  })

  // ── Runs ──────────────────────────────────────────────────────────────────
  ipcMain.handle('kennel:runAgentic', (_e, input: CreateAgenticRunInput) => {
    assertNoAgentBusy()
    return startAgenticRun(input)
  })
  ipcMain.handle('kennel:runDeterministic', (_e, input: CreateDeterministicRunInput) => {
    assertNoAgentBusy()
    return startDeterministicRun(input)
  })
  ipcMain.handle('kennel:runProcess', (_e, input: RunProcessInput) => {
    assertNoAgentBusy()
    return startProcessRun(input)
  })
  ipcMain.handle('kennel:cancelRun', (_e, runId: string) => cancelRun(runId))

  // ── Snapshot inspection ─────────────────────────────────────────────────
  ipcMain.handle('kennel:getFileTree', async (_e, nodeId: string) => {
    const project = store.getProject()
    const node = store.getNode(nodeId)
    if (!project || !node) return null
    const paths = await listTree(project.path, node.commit)
    return buildTree(project.name, paths)
  })

  ipcMain.handle('kennel:getFileContent', async (_e, nodeId: string, relPath: string) => {
    const project = store.getProject()
    const node = store.getNode(nodeId)
    if (!project || !node) return ''
    return showFile(project.path, node.commit, relPath)
  })

  // A node's persisted activity log (its latest run's streamed events) — used by
  // the Log view to show history after a restart, when nothing is in memory.
  ipcMain.handle('kennel:getNodeActivity', (_e, nodeId: string) => getNodeActivity(nodeId))

  ipcMain.handle('kennel:getNodeChanges', async (_e, nodeId: string) => {
    const project = store.getProject()
    const node = store.getNode(nodeId)
    if (!project || !node || !node.parentId) return []
    const parent = store.getNode(node.parentId)
    if (!parent) return []
    return nameStatus(project.path, parent.commit, node.commit)
  })

  ipcMain.handle('kennel:getNodeFileDiff', async (_e, nodeId: string, relPath: string) => {
    const project = store.getProject()
    const node = store.getNode(nodeId)
    if (!project || !node || !node.parentId) return null
    const parent = store.getNode(node.parentId)
    if (!parent) return null
    const entry = (await nameStatus(project.path, parent.commit, node.commit)).find(
      (e) => e.path === relPath
    )
    const status = entry?.status ?? 'M'
    const oldPath = entry?.oldPath
    const readSafe = async (commit: string, p: string): Promise<string | null> => {
      try {
        return await showFileStrict(project.path, commit, p)
      } catch {
        return null // file absent at that commit, or git failed — distinct from empty
      }
    }
    let before = status === 'A' ? null : await readSafe(parent.commit, oldPath ?? relPath)
    let after = status === 'D' ? null : await readSafe(node.commit, relPath)
    // Don't pour binary or huge blobs into the editor.
    const MAX = 1_000_000
    const isBinary = (s: string | null): boolean =>
      s !== null && (s.length > MAX || s.slice(0, 8000).includes('\u0000'))
    const binary = isBinary(before) || isBinary(after)
    if (binary) {
      before = null
      after = null
    }
    return { path: relPath, status, oldPath, before, after, binary }
  })

  // ── Local model server (llama.cpp, downloaded at runtime) ───────────────
  ipcMain.handle('kennel:getLocalDefaults', () => getDefaults())
  ipcMain.handle('kennel:getLocalStatus', () => getStatus())
  ipcMain.handle('kennel:getLocalSettings', () => ({
    config: store.getLocalConfig(),
    models: store.getLocalModels()
  }))
  ipcMain.handle('kennel:saveLocalConfig', (_e, config: LocalServerConfig | null) =>
    store.setLocalConfig(config)
  )
  ipcMain.handle('kennel:saveLocalModels', (_e, models: LocalModel[]) =>
    store.setLocalModels(models)
  )
  ipcMain.handle('kennel:startLocalServer', async (_e, config: LocalServerConfig) => {
    // Remember the exact config that was launched, so it's restored next session.
    store.setLocalConfig(config)
    return startServer(config)
  })
  ipcMain.handle('kennel:stopLocalServer', () => stopServer())

  ipcMain.handle('kennel:pickModelFile', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a GGUF model file',
      properties: ['openFile'],
      filters: [{ name: 'GGUF models', extensions: ['gguf'] }]
    })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  ipcMain.handle('kennel:pickBinaryFile', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose the llama-server executable',
      properties: ['openFile']
    })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // llama.cpp engine — fetched from GitHub, downloaded + installed at runtime.
  ipcMain.handle('kennel:listLlamaReleases', () => listReleases())
  ipcMain.handle('kennel:getLlamaEngines', () => engineState())
  ipcMain.handle('kennel:downloadLlamaRelease', (_e, tag: string) => downloadRelease(tag))
  ipcMain.handle('kennel:setActiveLlama', (_e, tag: string) => setActive(tag))
  ipcMain.handle('kennel:removeLlama', (_e, tag: string) => removeBuild(tag))

  // HuggingFace recommended models (unsloth GGUF).
  ipcMain.handle('kennel:listHfModels', (_e, query?: string) => listModels(query))
  ipcMain.handle('kennel:listHfModelFiles', (_e, repo: string) => listFiles(repo))
  ipcMain.handle('kennel:downloadHfModel', (_e, file: HfModelFile) => downloadModel(file))

  // First-run local-LLM setup prompt: track whether it's been seen/dismissed.
  ipcMain.handle('kennel:getLocalSetupSeen', () => store.getLocalSetupSeen())
  ipcMain.handle('kennel:setLocalSetupSeen', (_e, seen: boolean) => store.setLocalSetupSeen(seen))

  // Wake Mode — prevent the device from sleeping while working.
  ipcMain.handle('kennel:setWakeMode', (_e, enabled: boolean) => setWakeMode(enabled))
  ipcMain.handle('kennel:getWakeMode', () => isWakeMode())

  // App auto-update (GitHub Releases via electron-updater).
  ipcMain.handle('kennel:getUpdateState', () => getUpdateState())
  ipcMain.handle('kennel:checkForUpdates', () => checkForUpdates())
  ipcMain.handle('kennel:downloadUpdate', (_e, restartWhenReady: boolean) =>
    downloadUpdate(restartWhenReady)
  )
  ipcMain.handle('kennel:quitAndInstall', () => quitAndInstall())
}
