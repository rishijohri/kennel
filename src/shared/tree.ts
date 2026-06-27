// Pure tree helpers over the canvas node graph, shared by the renderer (canvas
// rendering) and the main process (Walker visibility). Nodes form a tree: each
// has a `parentId` (the root's is null).

/** Reserved id of the synthetic "Collapsed Source" node shown when a subtree is
 *  focused — it stands in for every node hidden behind the collapse. Never a real
 *  node id (those are UUIDs), so it's safe to special-case everywhere. */
export const COLLAPSED_ID = '__collapsed__'

interface TreeNode {
  id: string
  parentId: string | null
}

/**
 * The ids of `rootId` plus every transitive descendant (its whole subtree).
 * Returns an empty set if `rootId` isn't present.
 */
export function subtreeIds<T extends TreeNode>(nodes: T[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>()
  let exists = false
  for (const n of nodes) {
    if (n.id === rootId) exists = true
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId)
      if (arr) arr.push(n.id)
      else childrenOf.set(n.parentId, [n.id])
    }
  }
  const out = new Set<string>()
  if (!exists) return out
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    if (out.has(id)) continue
    out.add(id)
    const kids = childrenOf.get(id)
    if (kids) for (const k of kids) stack.push(k)
  }
  return out
}
