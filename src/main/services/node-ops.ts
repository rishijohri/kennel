import { store } from './store'
import { checkoutCommit, unpinNode } from './git'

/**
 * Delete a main-canvas node and all of its descendants. Park nodes also drop
 * their workflow records. If the active (checked-out) node is removed, the
 * working tree falls back to the root. Returns false for root / unknown nodes.
 */
export async function deleteCanvasNode(nodeId: string): Promise<boolean> {
  const project = store.getProject()
  const node = store.getNode(nodeId)
  if (!project || !node || node.kind === 'root') return false

  const nodes = store.getNodes()
  const toDelete = new Set<string>([nodeId])
  let grew = true
  while (grew) {
    grew = false
    for (const n of nodes) {
      if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
        toDelete.add(n.id)
        grew = true
      }
    }
  }

  for (const id of toDelete) {
    if (store.getPark(id)) store.deletePark(id)
    await unpinNode(project.path, id).catch(() => {})
  }
  store.replaceNodes(nodes.filter((n) => !toDelete.has(n.id)))

  if (toDelete.has(project.activeNodeId)) {
    const root = store.getNode(project.rootNodeId)
    if (root) {
      await checkoutCommit(project.path, root.commit)
      store.setActiveNode(root.id)
    }
  }
  return true
}
