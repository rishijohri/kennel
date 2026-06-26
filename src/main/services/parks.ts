import { randomUUID } from 'node:crypto'
import type {
  CanvasNode,
  CreateWorkflowNodeInput,
  Park,
  ParkKind,
  WorkflowNode
} from '@shared/types'
import { store } from './store'
import { deleteCanvasNode } from './node-ops'

/** Create a Park: a kind='park' node on the main canvas + its workflow record. */
export function createPark(input: {
  parentNodeId: string
  name: string
  parkKind: ParkKind
  position: { x: number; y: number }
}): string {
  const parent = store.getNode(input.parentNodeId)
  if (!parent) throw new Error('Parent node not found.')
  const id = randomUUID()
  const now = Date.now()
  const node: CanvasNode = {
    id,
    parentId: parent.id,
    commit: parent.commit, // the Park runs against this codebase snapshot
    title: input.name || 'Park',
    kind: 'park',
    status: 'done',
    parkKind: input.parkKind,
    summary: input.parkKind === 'schedule' ? 'Scheduled workflow' : 'Triggered workflow',
    createdAt: now,
    position: input.position
  }
  store.upsertNode(node)

  const park: Park = {
    id,
    name: input.name || 'Park',
    parkKind: input.parkKind,
    parentNodeId: parent.id,
    baseCommit: parent.commit,
    cron: '',
    scheduleEnabled: false,
    nodes: [
      {
        id: randomUUID(),
        parentId: null,
        kind: 'start',
        title: 'Start',
        position: { x: 0, y: 0 },
        createdAt: now,
        status: 'done'
      }
    ],
    lastRun: null,
    createdAt: now
  }
  store.upsertPark(park)
  // Every Park ships the built-in "Summarize Report" persona as a default report writer.
  store.ensureParkDefaults()
  return id
}

/** Delete a Park and its main-canvas node (plus any descendants of that node).
 *  deleteCanvasNode also drops the workflow record for any park node it removes. */
export async function deletePark(parkId: string): Promise<void> {
  await deleteCanvasNode(parkId)
}

/** Add a workflow step; returns the new step's id (used by the Walker to chain). */
export function addWorkflowNode(parkId: string, input: CreateWorkflowNodeInput): string {
  const park = store.getPark(parkId)
  if (!park) throw new Error('Park not found.')
  if (!park.nodes.some((n) => n.id === input.parentId)) {
    throw new Error('Workflow parent node not found.')
  }
  const defaultTitle =
    input.kind === 'agentic' ? 'Agent' : input.kind === 'report' ? 'Report' : 'Task'

  // A deterministic step given an ad-hoc command (no processId) is registered as
  // a reusable Park process, so every Park deterministic node is registry-backed
  // and listed under Park Processes (deduped by command).
  let processId = input.processId
  let command = input.command
  if (input.kind === 'deterministic' && !processId && command && command.trim()) {
    const proc = store.findOrCreateCommandProcess('park', input.title || defaultTitle, command)
    if (proc) {
      processId = proc.id
      command = undefined // the process is now the source of truth for the command
    }
  }

  const node: WorkflowNode = {
    id: randomUUID(),
    parentId: input.parentId,
    kind: input.kind,
    title: input.title || defaultTitle,
    personaId: input.personaId,
    prompt: input.prompt,
    command,
    processId,
    inputs: input.inputs,
    outputSpec: input.outputSpec,
    activation: input.activation,
    position: input.position,
    createdAt: Date.now()
  }
  store.upsertPark({ ...park, nodes: [...park.nodes, node] })
  return node.id
}

export function updateWorkflowNode(
  parkId: string,
  nodeId: string,
  patch: Partial<WorkflowNode>
): void {
  store.patchWorkflowNode(parkId, nodeId, patch)
}

/** Set the Park's objective — what the finished workflow must accomplish. */
export function setParkObjective(parkId: string, objective: string): void {
  store.patchPark(parkId, { objective: objective.trim() || undefined })
}

/** Delete a workflow node; its children re-parent to the deleted node's parent. */
export function deleteWorkflowNode(parkId: string, nodeId: string): void {
  const park = store.getPark(parkId)
  if (!park) return
  const target = park.nodes.find((n) => n.id === nodeId)
  if (!target || target.kind === 'start') return // the start node is permanent
  const nodes = park.nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => (n.parentId === nodeId ? { ...n, parentId: target.parentId } : n))
  store.upsertPark({ ...park, nodes })
}

export function setWorkflowNodePositions(
  parkId: string,
  updates: { id: string; position: { x: number; y: number } }[]
): void {
  const park = store.getPark(parkId)
  if (!park) return
  const byId = new Map(updates.map((u) => [u.id, u.position]))
  store.upsertPark({
    ...park,
    nodes: park.nodes.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n))
  })
}
