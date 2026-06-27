import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
  type ReactFlowInstance
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Workflow } from 'lucide-react'
import { useKennel } from '../../store/useKennel'
import { computeTreeLayout } from '../../lib/treeLayout'
import { subtreeIds, COLLAPSED_ID } from '@shared/tree'
import { KennelNode, type KennelNodeData } from './KennelNode'
import { CollapsedNode } from './CollapsedNode'

export function FlowCanvas() {
  const storeNodes = useKennel((s) => s.state?.nodes ?? [])
  const personas = useKennel((s) => s.state?.personas ?? [])
  const activeId = useKennel((s) => s.state?.project?.activeNodeId)
  // Primitive selector (no new object) — safe under Zustand v5.
  const focusedNodeId = useKennel((s) => s.state?.project?.focusedNodeId ?? null)
  const selectedNodeId = useKennel((s) => s.selectedNodeId)
  const running = useKennel((s) => s.running)
  const selectNode = useKennel((s) => s.selectNode)
  const updateNodePosition = useKennel((s) => s.updateNodePosition)
  const setNodePositions = useKennel((s) => s.setNodePositions)

  const nodeTypes = useMemo(() => ({ kennel: KennelNode, collapsed: CollapsedNode }), [])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<KennelNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const rfRef = useRef<ReactFlowInstance<Node<KennelNodeData>, Edge> | null>(null)

  useEffect(() => {
    // When a node is focused, show ONLY its subtree; collapse everything else
    // behind one synthetic "Collapsed Source" node placed above the focus.
    const visible = focusedNodeId ? subtreeIds(storeNodes, focusedNodeId) : null
    const focusing = Boolean(visible && storeNodes.some((n) => n.id === focusedNodeId))
    setNodes((prev) => {
      const list = focusing ? storeNodes.filter((n) => visible!.has(n.id)) : storeNodes
      const real = list.map((n) => {
        const existing = prev.find((p) => p.id === n.id)
        return {
          id: n.id,
          type: 'kennel',
          position: existing?.position ?? n.position,
          data: {
            node: n,
            persona: personas.find((p) => p.id === n.personaId),
            isSelected: n.id === selectedNodeId,
            isActive: n.id === activeId,
            isRunning: Boolean(running[n.id]) || n.status === 'running'
          }
        } as Node<KennelNodeData>
      })
      if (focusing) {
        const fn = real.find((r) => r.id === focusedNodeId)!
        real.push({
          id: COLLAPSED_ID,
          type: 'collapsed',
          deletable: false,
          position: { x: fn.position.x, y: fn.position.y - 150 },
          data: {
            count: storeNodes.length - visible!.size,
            activeInside: Boolean(activeId && !visible!.has(activeId)),
            runningInside: storeNodes.some(
              (n) => !visible!.has(n.id) && (Boolean(running[n.id]) || n.status === 'running')
            )
          }
        } as unknown as Node<KennelNodeData>)
      }
      return real
    })
  }, [storeNodes, personas, selectedNodeId, activeId, running, focusedNodeId, setNodes])

  useEffect(() => {
    const visible = focusedNodeId ? subtreeIds(storeNodes, focusedNodeId) : null
    const focusing = Boolean(visible && storeNodes.some((n) => n.id === focusedNodeId))
    const mkEdge = (source: string, target: string, animated: boolean): Edge => ({
      id: `e-${source}-${target}`,
      source,
      target,
      type: 'smoothstep',
      animated
    })
    if (focusing) {
      const edges = storeNodes
        .filter((n) => n.parentId && visible!.has(n.id) && visible!.has(n.parentId as string))
        .map((n) => mkEdge(n.parentId as string, n.id, Boolean(running[n.id]) || n.status === 'running'))
      edges.push(mkEdge(COLLAPSED_ID, focusedNodeId as string, false))
      setEdges(edges)
    } else {
      setEdges(
        storeNodes
          .filter((n) => n.parentId)
          .map((n) => mkEdge(n.parentId as string, n.id, Boolean(running[n.id]) || n.status === 'running'))
      )
    }
  }, [storeNodes, running, focusedNodeId, setEdges])

  // Re-fit the viewport when collapsing/expanding so the new visible set is framed.
  useEffect(() => {
    const t = setTimeout(() => rfRef.current?.fitView({ padding: 0.3, duration: 400 }), 80)
    return () => clearTimeout(t)
  }, [focusedNodeId])

  const onNodeClick: NodeMouseHandler = useCallback(
    // The collapsed stub handles its own click (expand); never "select" it.
    (_e, node) => {
      if (node.id !== COLLAPSED_ID) selectNode(node.id)
    },
    [selectNode]
  )

  const onNodeDragStop: OnNodeDrag<Node<KennelNodeData>> = useCallback(
    (_e, node) => {
      if (node.id !== COLLAPSED_ID) updateNodePosition(node.id, node.position)
    },
    [updateNodePosition]
  )

  const arrange = useCallback(() => {
    if (storeNodes.length === 0) return
    // When focused, lay out only the visible subtree (focus node as the root).
    const visible = focusedNodeId ? subtreeIds(storeNodes, focusedNodeId) : null
    const focusing = Boolean(visible && storeNodes.some((n) => n.id === focusedNodeId))
    const subset = focusing
      ? storeNodes
          .filter((n) => visible!.has(n.id))
          .map((n) => (n.id === focusedNodeId ? { ...n, parentId: null } : n))
      : storeNodes
    const updates = computeTreeLayout(subset)
    const byId = new Map(updates.map((u) => [u.id, u.position]))
    // Apply immediately (overriding any local drag positions), persist, recenter.
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id === COLLAPSED_ID) {
          const fp = focusedNodeId ? byId.get(focusedNodeId) : undefined
          return fp ? { ...n, position: { x: fp.x, y: fp.y - 150 } } : n
        }
        return byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n
      })
    )
    setNodePositions(updates)
    setTimeout(() => rfRef.current?.fitView({ padding: 0.3, duration: 400 }), 60)
  }, [storeNodes, focusedNodeId, setNodes, setNodePositions])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onNodeDragStop={onNodeDragStop}
      onPaneClick={() => selectNode(null)}
      onInit={(inst) => (rfRef.current = inst)}
      // Node deletion goes through the inspector's Trash button (→ store). The
      // default Backspace/Delete keys only mutate local RF state, desyncing the
      // store and orphaning the synthetic collapsed node — so disable them.
      deleteKeyCode={null}
      fitView
      fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={1.75}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(124,108,255,0.6)', width: 18, height: 18 }
      }}
    >
      <Panel position="top-right" className="!m-3">
        <button
          onClick={arrange}
          title="Auto-arrange the nodes into a tidy tree"
          className="no-drag flex items-center gap-1.5 rounded-lg border border-line bg-surface-overlay px-3 py-1.5 text-xs font-medium text-ink-soft shadow-node transition-colors hover:border-line-strong hover:text-ink"
        >
          <Workflow size={13} />
          Tidy up
        </button>
      </Panel>
      <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="rgba(124,108,255,0.12)" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        className="!bg-surface-raised !border !border-line"
        maskColor="rgba(10,11,16,0.7)"
        nodeColor={(n) => {
          const data = n.data as KennelNodeData
          if (data?.node?.kind === 'deterministic') return '#ffb454'
          if (data?.node?.kind === 'root') return '#7c6cff'
          return data?.persona?.color ?? '#7c6cff'
        }}
      />
    </ReactFlow>
  )
}
