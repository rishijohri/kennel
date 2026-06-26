/** Minimal shape a node needs to be laid out as a tidy tree. */
export interface LayoutNode {
  id: string
  parentId: string | null
  createdAt: number
  position: { x: number; y: number }
}

/**
 * Tidy top-down tree layout. Leaves are packed left→right; each parent is
 * centered over the span of its children. Handles a forest (multiple roots) and
 * orphaned nodes (missing parent) by treating them as roots. Siblings keep
 * creation order so the layout is stable. Shared by the main canvas and Parks.
 */
export function computeTreeLayout<T extends LayoutNode>(
  nodes: T[],
  hGap = 320,
  vGap = 240
): { id: string; position: { x: number; y: number } }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string, T[]>()
  for (const n of nodes) {
    if (n.parentId && byId.has(n.parentId)) {
      const arr = children.get(n.parentId) ?? []
      arr.push(n)
      children.set(n.parentId, arr)
    }
  }
  for (const arr of children.values()) arr.sort((a, b) => a.createdAt - b.createdAt)

  const roots = nodes
    .filter((n) => !n.parentId || !byId.has(n.parentId))
    .sort((a, b) => a.createdAt - b.createdAt)

  const pos = new Map<string, { x: number; y: number }>()
  let cursor = 0
  const place = (id: string, depth: number): number => {
    const kids = children.get(id) ?? []
    let x: number
    if (kids.length === 0) {
      x = cursor
      cursor += hGap
    } else {
      const xs = kids.map((k) => place(k.id, depth + 1))
      x = (xs[0] + xs[xs.length - 1]) / 2
    }
    pos.set(id, { x, y: depth * vGap })
    return x
  }
  for (const r of roots) {
    place(r.id, 0)
    cursor += hGap // gutter between separate trees
  }
  return nodes.map((n) => ({ id: n.id, position: pos.get(n.id) ?? n.position }))
}
