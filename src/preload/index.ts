import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentPersona,
  CaretakerConfig,
  CaretakerEvent,
  CopilotSetupEvent,
  CreateAgenticRunInput,
  CreateDeterministicRunInput,
  DeterministicProcess,
  DownloadProgress,
  HfModelFile,
  KennelApi,
  LocalModel,
  LocalServerConfig,
  LocalServerStatus,
  RunEvent,
  RunProcessInput,
  SaveProviderInput,
  KennelState,
  UpdateState,
  WalkerAutonomy,
  WalkerConfig,
  WalkerEvent
} from '@shared/types'

const api: KennelApi = {
  getState: () => ipcRenderer.invoke('kennel:getState'),

  saveProvider: (input: SaveProviderInput) => ipcRenderer.invoke('kennel:saveProvider', input),
  deleteProvider: (id) => ipcRenderer.invoke('kennel:deleteProvider', id),
  testProvider: (id) => ipcRenderer.invoke('kennel:testProvider', id),
  switchProviderModel: (input) => ipcRenderer.invoke('kennel:switchProviderModel', input),

  getCopilotStatus: () => ipcRenderer.invoke('kennel:getCopilotStatus'),
  installCopilot: () => ipcRenderer.invoke('kennel:installCopilot'),
  loginCopilot: () => ipcRenderer.invoke('kennel:loginCopilot'),
  cancelCopilotSetup: () => ipcRenderer.invoke('kennel:cancelCopilotSetup'),

  savePersona: (persona: AgentPersona) => ipcRenderer.invoke('kennel:savePersona', persona),
  addPersonaToProject: (id) => ipcRenderer.invoke('kennel:addPersonaToProject', id),
  removePersonaFromProject: (id) => ipcRenderer.invoke('kennel:removePersonaFromProject', id),
  deletePersonaFromLibrary: (id) => ipcRenderer.invoke('kennel:deletePersonaFromLibrary', id),

  saveProcess: (process: DeterministicProcess) => ipcRenderer.invoke('kennel:saveProcess', process),
  deleteProcess: (id) => ipcRenderer.invoke('kennel:deleteProcess', id),

  saveMcpServer: (server) => ipcRenderer.invoke('kennel:saveMcpServer', server),
  addMcpServerToProject: (id) => ipcRenderer.invoke('kennel:addMcpServerToProject', id),
  removeMcpServerFromProject: (id) => ipcRenderer.invoke('kennel:removeMcpServerFromProject', id),
  deleteMcpServerFromLibrary: (id) => ipcRenderer.invoke('kennel:deleteMcpServerFromLibrary', id),
  testMcpServer: (server) => ipcRenderer.invoke('kennel:testMcpServer', server),
  getMcpServerSecrets: (id) => ipcRenderer.invoke('kennel:getMcpServerSecrets', id),

  saveCaretaker: (config: CaretakerConfig | null) =>
    ipcRenderer.invoke('kennel:saveCaretaker', config),
  createCaretakerChat: () => ipcRenderer.invoke('kennel:createCaretakerChat'),
  deleteCaretakerChat: (chatId) => ipcRenderer.invoke('kennel:deleteCaretakerChat', chatId),
  renameCaretakerChat: (chatId, title) =>
    ipcRenderer.invoke('kennel:renameCaretakerChat', chatId, title),
  runCaretaker: (input: { chatId: string; message: string }) =>
    ipcRenderer.invoke('kennel:runCaretaker', input),
  cancelCaretaker: () => ipcRenderer.invoke('kennel:cancelCaretaker'),

  saveWalker: (config: WalkerConfig | null) => ipcRenderer.invoke('kennel:saveWalker', config),
  createWalkerChat: () => ipcRenderer.invoke('kennel:createWalkerChat'),
  deleteWalkerChat: (chatId) => ipcRenderer.invoke('kennel:deleteWalkerChat', chatId),
  renameWalkerChat: (chatId, title) =>
    ipcRenderer.invoke('kennel:renameWalkerChat', chatId, title),
  runWalker: (input: {
    chatId: string
    message: string
    autonomy: WalkerAutonomy
    parkId?: string
  }) => ipcRenderer.invoke('kennel:runWalker', input),
  cancelWalker: () => ipcRenderer.invoke('kennel:cancelWalker'),

  pickFolder: () => ipcRenderer.invoke('kennel:pickFolder'),
  openProject: (path) => ipcRenderer.invoke('kennel:openProject', path),
  closeProject: () => ipcRenderer.invoke('kennel:closeProject'),
  removeProject: (id) => ipcRenderer.invoke('kennel:removeProject', id),

  createPark: (input) => ipcRenderer.invoke('kennel:createPark', input),
  deletePark: (parkId) => ipcRenderer.invoke('kennel:deletePark', parkId),
  setShareParkCapabilities: (shared) =>
    ipcRenderer.invoke('kennel:setShareParkCapabilities', shared),
  saveParkSchedule: (parkId, cron, enabled) =>
    ipcRenderer.invoke('kennel:saveParkSchedule', parkId, cron, enabled),
  addWorkflowNode: (parkId, node) => ipcRenderer.invoke('kennel:addWorkflowNode', parkId, node),
  updateWorkflowNode: (parkId, nodeId, patch) =>
    ipcRenderer.invoke('kennel:updateWorkflowNode', parkId, nodeId, patch),
  deleteWorkflowNode: (parkId, nodeId) =>
    ipcRenderer.invoke('kennel:deleteWorkflowNode', parkId, nodeId),
  setWorkflowNodePositions: (parkId, updates) =>
    ipcRenderer.invoke('kennel:setWorkflowNodePositions', parkId, updates),
  runWorkflow: (parkId, mode) => ipcRenderer.invoke('kennel:runWorkflow', parkId, mode),
  cancelWorkflow: (parkId) => ipcRenderer.invoke('kennel:cancelWorkflow', parkId),
  getRunWorkspaceTree: (parkId, runId) =>
    ipcRenderer.invoke('kennel:getRunWorkspaceTree', parkId, runId),
  getRunWorkspaceFile: (parkId, runId, relPath) =>
    ipcRenderer.invoke('kennel:getRunWorkspaceFile', parkId, runId, relPath),

  selectNode: (nodeId) => ipcRenderer.invoke('kennel:selectNode', nodeId),
  setFocusedNode: (nodeId) => ipcRenderer.invoke('kennel:setFocusedNode', nodeId),
  updateNodePosition: (nodeId, position) =>
    ipcRenderer.invoke('kennel:updateNodePosition', nodeId, position),
  updateNodePositions: (updates) => ipcRenderer.invoke('kennel:updateNodePositions', updates),
  deleteNode: (nodeId) => ipcRenderer.invoke('kennel:deleteNode', nodeId),

  runAgentic: (input: CreateAgenticRunInput) => ipcRenderer.invoke('kennel:runAgentic', input),
  runDeterministic: (input: CreateDeterministicRunInput) =>
    ipcRenderer.invoke('kennel:runDeterministic', input),
  runProcess: (input: RunProcessInput) => ipcRenderer.invoke('kennel:runProcess', input),
  cancelRun: (runId) => ipcRenderer.invoke('kennel:cancelRun', runId),

  getFileTree: (nodeId) => ipcRenderer.invoke('kennel:getFileTree', nodeId),
  getFileContent: (nodeId, relPath) =>
    ipcRenderer.invoke('kennel:getFileContent', nodeId, relPath),
  getNodeChanges: (nodeId) => ipcRenderer.invoke('kennel:getNodeChanges', nodeId),
  getNodeActivity: (nodeId) => ipcRenderer.invoke('kennel:getNodeActivity', nodeId),
  getNodeFileDiff: (nodeId, relPath) =>
    ipcRenderer.invoke('kennel:getNodeFileDiff', nodeId, relPath),

  getLocalDefaults: () => ipcRenderer.invoke('kennel:getLocalDefaults'),
  getLocalStatus: () => ipcRenderer.invoke('kennel:getLocalStatus'),
  getLocalSettings: () => ipcRenderer.invoke('kennel:getLocalSettings'),
  saveLocalConfig: (config: LocalServerConfig | null) =>
    ipcRenderer.invoke('kennel:saveLocalConfig', config),
  saveLocalModels: (models: LocalModel[]) => ipcRenderer.invoke('kennel:saveLocalModels', models),
  startLocalServer: (config: LocalServerConfig) =>
    ipcRenderer.invoke('kennel:startLocalServer', config),
  stopLocalServer: () => ipcRenderer.invoke('kennel:stopLocalServer'),
  pickModelFile: () => ipcRenderer.invoke('kennel:pickModelFile'),
  pickBinaryFile: () => ipcRenderer.invoke('kennel:pickBinaryFile'),

  listLlamaReleases: () => ipcRenderer.invoke('kennel:listLlamaReleases'),
  getLlamaEngines: () => ipcRenderer.invoke('kennel:getLlamaEngines'),
  downloadLlamaRelease: (tag: string) => ipcRenderer.invoke('kennel:downloadLlamaRelease', tag),
  setActiveLlama: (tag: string) => ipcRenderer.invoke('kennel:setActiveLlama', tag),
  removeLlama: (tag: string) => ipcRenderer.invoke('kennel:removeLlama', tag),

  listHfModels: (query?: string) => ipcRenderer.invoke('kennel:listHfModels', query),
  listHfModelFiles: (repo: string) => ipcRenderer.invoke('kennel:listHfModelFiles', repo),
  downloadHfModel: (file: HfModelFile) => ipcRenderer.invoke('kennel:downloadHfModel', file),

  getLocalSetupSeen: () => ipcRenderer.invoke('kennel:getLocalSetupSeen'),
  setLocalSetupSeen: (seen: boolean) => ipcRenderer.invoke('kennel:setLocalSetupSeen', seen),

  setWakeMode: (enabled: boolean) => ipcRenderer.invoke('kennel:setWakeMode', enabled),
  getWakeMode: () => ipcRenderer.invoke('kennel:getWakeMode'),

  getUpdateState: () => ipcRenderer.invoke('kennel:getUpdateState'),
  checkForUpdates: () => ipcRenderer.invoke('kennel:checkForUpdates'),
  downloadUpdate: (restartWhenReady: boolean) =>
    ipcRenderer.invoke('kennel:downloadUpdate', restartWhenReady),
  quitAndInstall: () => ipcRenderer.invoke('kennel:quitAndInstall'),

  onRunEvent: (cb: (e: RunEvent) => void) => {
    const listener = (_: unknown, e: RunEvent) => cb(e)
    ipcRenderer.on('kennel:run-event', listener)
    return () => ipcRenderer.removeListener('kennel:run-event', listener)
  },
  onStateChanged: (cb: (s: KennelState) => void) => {
    const listener = (_: unknown, s: KennelState) => cb(s)
    ipcRenderer.on('kennel:state-changed', listener)
    return () => ipcRenderer.removeListener('kennel:state-changed', listener)
  },
  onLocalStatus: (cb: (s: LocalServerStatus) => void) => {
    const listener = (_: unknown, s: LocalServerStatus) => cb(s)
    ipcRenderer.on('kennel:local-status', listener)
    return () => ipcRenderer.removeListener('kennel:local-status', listener)
  },
  onCaretakerEvent: (cb: (e: CaretakerEvent) => void) => {
    const listener = (_: unknown, e: CaretakerEvent) => cb(e)
    ipcRenderer.on('kennel:caretaker-event', listener)
    return () => ipcRenderer.removeListener('kennel:caretaker-event', listener)
  },
  onWalkerEvent: (cb: (e: WalkerEvent) => void) => {
    const listener = (_: unknown, e: WalkerEvent) => cb(e)
    ipcRenderer.on('kennel:walker-event', listener)
    return () => ipcRenderer.removeListener('kennel:walker-event', listener)
  },
  onDownloadProgress: (cb: (p: DownloadProgress) => void) => {
    const listener = (_: unknown, p: DownloadProgress) => cb(p)
    ipcRenderer.on('kennel:download-progress', listener)
    return () => ipcRenderer.removeListener('kennel:download-progress', listener)
  },
  onUpdateEvent: (cb: (s: UpdateState) => void) => {
    const listener = (_: unknown, s: UpdateState) => cb(s)
    ipcRenderer.on('kennel:update-event', listener)
    return () => ipcRenderer.removeListener('kennel:update-event', listener)
  },
  onCopilotSetup: (cb: (e: CopilotSetupEvent) => void) => {
    const listener = (_: unknown, e: CopilotSetupEvent) => cb(e)
    ipcRenderer.on('kennel:copilot-setup', listener)
    return () => ipcRenderer.removeListener('kennel:copilot-setup', listener)
  }
}

contextBridge.exposeInMainWorld('kennel', api)
