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
import { KennelNode, type KennelNodeData } from './KennelNode'

export function FlowCanvas() {
  const storeNodes = useKennel((s) => s.state?.nodes ?? [])
  const personas = useKennel((s) => s.state?.personas ?? [])
  const activeId = useKennel((s) => s.state?.project?.activeNodeId)
  const selectedNodeId = useKennel((s) => s.selectedNodeId)
  const running = useKennel((s) => s.running)
  const selectNode = useKennel((s) => s.selectNode)
  const updateNodePosition = useKennel((s) => s.updateNodePosition)
  const setNodePositions = useKennel((s) => s.setNodePositions)

  const nodeTypes = useMemo(() => ({ kennel: KennelNode }), [])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<KennelNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const rfRef = useRef<ReactFlowInstance<Node<KennelNodeData>, Edge> | null>(null)

  useEffect(() => {
    setNodes((prev) =>
      storeNodes.map((n) => {
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
        }
      })
    )
  }, [storeNodes, personas, selectedNodeId, activeId, running, setNodes])

  useEffect(() => {
    setEdges(
      storeNodes
        .filter((n) => n.parentId)
        .map((n) => ({
          id: `e-${n.parentId}-${n.id}`,
          source: n.parentId as string,
          target: n.id,
          type: 'smoothstep',
          animated: Boolean(running[n.id]) || n.status === 'running'
        }))
    )
  }, [storeNodes, running, setEdges])

  const onNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => selectNode(node.id),
    [selectNode]
  )

  const onNodeDragStop: OnNodeDrag<Node<KennelNodeData>> = useCallback(
    (_e, node) => updateNodePosition(node.id, node.position),
    [updateNodePosition]
  )

  const arrange = useCallback(() => {
    if (storeNodes.length === 0) return
    const updates = computeTreeLayout(storeNodes)
    const byId = new Map(updates.map((u) => [u.id, u.position]))
    // Apply immediately (overriding any local drag positions), persist, recenter.
    setNodes((prev) => prev.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n)))
    setNodePositions(updates)
    setTimeout(() => rfRef.current?.fitView({ padding: 0.3, duration: 400 }), 60)
  }, [storeNodes, setNodes, setNodePositions])

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
