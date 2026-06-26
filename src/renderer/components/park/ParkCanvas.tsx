import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type OnNodeDrag,
  type ReactFlowInstance
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { clsx } from 'clsx'
import {
  ArrowLeft,
  Play,
  Square,
  Plus,
  Trash2,
  Sparkles,
  TerminalSquare,
  FileText,
  Flag,
  Check,
  AlertTriangle,
  Clock,
  Zap,
  Loader2,
  History,
  SkipForward,
  GitBranch,
  Target,
  ArrowRightLeft,
  BadgeCheck,
  Wand2
} from 'lucide-react'
import type { AgentPersona, Park, WorkflowNode, WorkflowRunMode } from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { computeTreeLayout } from '../../lib/treeLayout'
import { Spinner } from '../ui'
import { cronValid } from './cron-hint'
import { RunModeModal } from './RunModeModal'
import { StepInspector } from './StepInspector'
import { RunHistory } from './RunHistory'
import { summarizeActivation } from './activation'

interface WfData {
  node: WorkflowNode
  persona?: AgentPersona
  parkId: string
  isSelected: boolean
  /** XCom contract summary inherited from the node's capability. */
  io?: { inputs: number; outputs: number; tested?: boolean }
  /** Command of the linked process (deterministic steps store it on the process). */
  commandPreview?: string
  [key: string]: unknown
}

const PARK_ACCENT = '#56b6ff'

function StatusPill({ node }: { node: WorkflowNode }) {
  if (node.status === 'running')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-iris/15 px-2 py-0.5 text-[10px] font-medium text-iris-soft">
        <Spinner size={9} /> running
      </span>
    )
  if (node.status === 'skipped')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber/12 px-2 py-0.5 text-[10px] font-medium text-amber-soft">
        <SkipForward size={10} /> skipped
      </span>
    )
  if (node.resultState && node.resultState !== 'skipped')
    return (
      <span
        className={clsx(
          'inline-flex max-w-[110px] items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-medium',
          node.resultStateKind === 'failure'
            ? 'bg-rose/15 text-rose'
            : node.resultStateKind === 'success'
              ? 'bg-mint/12 text-mint'
              : 'bg-amber/12 text-amber-soft'
        )}
      >
        {node.resultStateKind === 'failure' ? <AlertTriangle size={10} /> : <Check size={10} />}
        {node.resultState}
      </span>
    )
  if (node.status === 'error')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose/15 px-2 py-0.5 text-[10px] font-medium text-rose">
        <AlertTriangle size={10} /> error
      </span>
    )
  if (node.status === 'done')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-mint/12 px-2 py-0.5 text-[10px] font-medium text-mint">
        <Check size={10} /> done
      </span>
    )
  return null
}

function WorkflowCardImpl({ data }: NodeProps) {
  const { node, persona, parkId, isSelected, io, commandPreview } = data as WfData
  const openLauncher = useKennel((s) => s.openLauncher)
  const deleteWorkflowNode = useKennel((s) => s.deleteWorkflowNode)

  const accent =
    node.kind === 'agentic'
      ? persona?.color ?? '#7c6cff'
      : node.kind === 'deterministic'
        ? '#ffb454'
        : node.kind === 'report'
          ? '#56d6a0'
          : PARK_ACCENT
  const dimmed = node.status === 'skipped'

  return (
    <div
      className={clsx(
        'group relative w-[240px] rounded-2xl border bg-surface-raised/95 shadow-node transition-all',
        isSelected ? 'border-transparent ring-2' : 'border-line hover:border-line-strong',
        dimmed && 'opacity-60'
      )}
      style={isSelected ? ({ '--tw-ring-color': accent } as React.CSSProperties) : undefined}
    >
      {node.kind !== 'start' && <Handle type="target" position={Position.Top} className="!top-[-5px]" />}

      <div className="flex items-start gap-2.5 p-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base"
          style={{ background: `${accent}22`, boxShadow: `inset 0 0 0 1px ${accent}55`, color: accent }}
        >
          {node.kind === 'start' ? (
            <Flag size={15} />
          ) : node.kind === 'agentic' ? (
            persona?.emoji ?? <Sparkles size={15} />
          ) : node.kind === 'report' ? (
            <FileText size={15} />
          ) : (
            <TerminalSquare size={15} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-ink">{node.title}</span>
            <StatusPill node={node} />
          </div>
          <p className="mt-0.5 truncate text-[11px] capitalize text-ink-ghost">
            {node.kind === 'start' ? 'workflow start' : node.kind}
          </p>
        </div>
      </div>

      {node.activation && (
        <div className="mx-3 mb-1 flex items-center gap-1 truncate rounded-md bg-iris/10 px-1.5 py-0.5 text-[10px] text-iris-soft">
          <GitBranch size={9} className="shrink-0" />
          <span className="truncate font-mono">{summarizeActivation(node.activation)}</span>
        </div>
      )}

      {(node.prompt || node.command || node.summary || commandPreview) && node.kind !== 'start' && (
        <div className="px-3 pb-2">
          <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-faint">
            {node.summary ?? node.prompt ?? node.command ?? commandPreview}
          </p>
        </div>
      )}

      {node.outputSpec && node.kind !== 'start' && (
        <div className="mx-3 mb-2 truncate border-t border-line/50 pt-1.5 text-[10px] text-ink-ghost">
          <span className="text-ink-faint">outputs:</span> {node.outputSpec}
        </div>
      )}

      {io && (io.inputs > 0 || io.outputs > 0) && (
        <div className="mx-3 mb-2.5 flex items-center gap-1.5 text-[9.5px] text-ink-ghost">
          <ArrowRightLeft size={9} className="shrink-0" />
          <span className="font-mono">
            {io.inputs} in · {io.outputs} out
          </span>
          {io.tested ? (
            <span className="flex items-center gap-0.5 rounded bg-mint/12 px-1 py-0.5 text-mint">
              <BadgeCheck size={9} /> tested
            </span>
          ) : (
            <span className="rounded bg-amber/12 px-1 py-0.5 text-amber-soft">untested</span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bottom-[-5px]" />

      {/* Add a child step */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          openLauncher(node.id, undefined, parkId)
        }}
        title="Add a step after this one"
        className="no-drag absolute -bottom-3 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-line-strong bg-surface-overlay text-ink-soft opacity-0 shadow-node transition-all hover:scale-110 hover:text-iris-soft group-hover:opacity-100"
        style={{ pointerEvents: 'all' }}
      >
        <Plus size={13} />
      </button>

      {node.kind !== 'start' && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            void deleteWorkflowNode(parkId, node.id)
          }}
          title="Delete step"
          className="no-drag absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface-overlay text-ink-ghost opacity-0 shadow-node transition-all hover:text-rose group-hover:opacity-100"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}
const WorkflowCard = memo(WorkflowCardImpl)

export function ParkCanvas({ park }: { park: Park }) {
  const personas = useKennel((s) => s.state?.personas ?? [])
  const processes = useKennel((s) => s.state?.deterministicProcesses ?? [])
  const closePark = useKennel((s) => s.closePark)
  const runWorkflow = useKennel((s) => s.runWorkflow)
  const cancelWorkflow = useKennel((s) => s.cancelWorkflow)
  const deletePark = useKennel((s) => s.deletePark)
  const saveParkSchedule = useKennel((s) => s.saveParkSchedule)
  const setWorkflowNodePositions = useKennel((s) => s.setWorkflowNodePositions)

  const nodeTypes = useMemo(() => ({ wf: WorkflowCard }), [])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WfData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runModeOpen, setRunModeOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const rfRef = useRef<ReactFlowInstance<Node<WfData>, Edge> | null>(null)

  const running = park.lastRun?.status === 'running'

  /** Reorganize the workflow into a tidy top-down tree (Park cards are ~240px). */
  const tidyUp = useCallback(() => {
    if (park.nodes.length === 0) return
    const updates = computeTreeLayout(park.nodes, 280, 200)
    const byId = new Map(updates.map((u) => [u.id, u.position]))
    setNodes((prev) => prev.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n)))
    setWorkflowNodePositions(park.id, updates)
    setTimeout(() => rfRef.current?.fitView({ padding: 0.3, duration: 400 }), 60)
  }, [park.nodes, park.id, setNodes, setWorkflowNodePositions])

  useEffect(() => {
    setNodes((prev) =>
      park.nodes.map((n) => {
        const existing = prev.find((p) => p.id === n.id)
        const stepProcess = n.kind === 'deterministic' ? processes.find((p) => p.id === n.processId) : undefined
        const contract =
          n.kind === 'agentic'
            ? personas.find((p) => p.id === n.personaId)?.ioContract
            : n.kind === 'deterministic'
              ? stepProcess?.ioContract
              : undefined
        return {
          id: n.id,
          type: 'wf',
          position: existing?.position ?? n.position,
          data: {
            node: n,
            persona: personas.find((p) => p.id === n.personaId),
            parkId: park.id,
            isSelected: n.id === selectedId,
            commandPreview: n.command ?? stepProcess?.command,
            io: contract
              ? { inputs: contract.inputs.length, outputs: contract.outputs.length, tested: contract.tested }
              : undefined
          }
        }
      })
    )
  }, [park, personas, processes, selectedId, setNodes])

  useEffect(() => {
    setEdges(
      park.nodes
        .filter((n) => n.parentId)
        .map((n) => {
          const conditional = Boolean(n.activation)
          return {
            id: `e-${n.parentId}-${n.id}`,
            source: n.parentId as string,
            target: n.id,
            type: 'smoothstep',
            animated: n.status === 'running',
            label: conditional ? summarizeActivation(n.activation!) : undefined,
            labelShowBg: conditional,
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 6,
            labelBgStyle: { fill: 'rgba(124,108,255,0.16)' },
            labelStyle: { fill: '#a99bff', fontSize: 10, fontFamily: 'ui-monospace, monospace' },
            style: conditional
              ? { stroke: 'rgba(124,108,255,0.7)', strokeDasharray: '5 3' }
              : n.status === 'skipped'
                ? { stroke: 'rgba(255,255,255,0.12)' }
                : undefined
          }
        })
    )
  }, [park, setEdges])

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => setSelectedId(node.id), [])
  const onNodeDragStop: OnNodeDrag<Node<WfData>> = useCallback(
    (_e, node) => setWorkflowNodePositions(park.id, [{ id: node.id, position: node.position }]),
    [park.id, setWorkflowNodePositions]
  )

  const selected = park.nodes.find((n) => n.id === selectedId)

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <ParkHeader
        park={park}
        running={running}
        onBack={closePark}
        onRun={() => setRunModeOpen(true)}
        onCancel={() => void cancelWorkflow(park.id)}
        onDelete={() => void deletePark(park.id)}
        onSchedule={(cron, enabled) => void saveParkSchedule(park.id, cron, enabled)}
        onHistory={() => setHistoryOpen(true)}
      />
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => setSelectedId(null)}
          onInit={(inst) => (rfRef.current = inst)}
          fitView
          fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.75}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(86,182,255,0.6)', width: 18, height: 18 }
          }}
        >
          <Panel position="top-left" className="!m-3 max-w-xs rounded-xl border border-line bg-surface-overlay/90 px-3 py-2 text-[11px] text-ink-faint shadow-node">
            Build the workflow with <span className="text-ink-soft">＋</span> on each step. It runs
            top-down from <span className="text-ink-soft">Start</span> when triggered.
          </Panel>
          <Panel position="top-right" className="!m-3">
            <button
              onClick={tidyUp}
              title="Reorganize the workflow into a tidy tree"
              className="no-drag flex items-center gap-1.5 rounded-lg border border-line bg-surface-overlay px-3 py-1.5 text-xs font-medium text-ink-soft shadow-node transition-colors hover:border-line-strong hover:text-ink"
            >
              <Wand2 size={13} />
              Tidy up
            </button>
          </Panel>
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="rgba(86,182,255,0.12)" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>

        {selected && selected.kind !== 'start' && (
          <StepInspector park={park} node={selected} onClose={() => setSelectedId(null)} />
        )}
      </div>

      <RunModeModal
        open={runModeOpen}
        onClose={() => setRunModeOpen(false)}
        onPick={(mode: WorkflowRunMode) => {
          setRunModeOpen(false)
          void runWorkflow(park.id, mode)
        }}
      />
      {historyOpen && <RunHistory park={park} onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}

function ParkHeader({
  park,
  running,
  onBack,
  onRun,
  onCancel,
  onDelete,
  onSchedule,
  onHistory
}: {
  park: Park
  running: boolean
  onBack: () => void
  onRun: () => void
  onCancel: () => void
  onDelete: () => void
  onSchedule: (cron: string, enabled: boolean) => void
  onHistory: () => void
}) {
  const [cron, setCron] = useState(park.cron)
  useEffect(() => setCron(park.cron), [park.cron])
  const cronOk = cron.trim() === '' || cronValid(cron.trim())

  const last = park.lastRun
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-line/70 bg-surface/50 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="no-drag flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <ArrowLeft size={14} />
          Canvas
        </button>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: `${PARK_ACCENT}22`, boxShadow: `inset 0 0 0 1px ${PARK_ACCENT}55`, color: PARK_ACCENT }}
        >
          {park.parkKind === 'schedule' ? <Clock size={15} /> : <Zap size={15} />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{park.name}</div>
          <div className="flex items-center text-[11px] text-ink-faint">
            {park.parkKind === 'schedule' ? 'Scheduled workflow' : 'Triggered workflow'}
            {last && (
              <span className="ml-2 text-ink-ghost">
                · last run{' '}
                <span
                  className={
                    last.status === 'error'
                      ? 'text-rose'
                      : last.status === 'running'
                        ? 'text-iris-soft'
                        : 'text-mint'
                  }
                >
                  {last.status}
                </span>
              </span>
            )}
            {last && (
              <span
                className={clsx(
                  'ml-2 rounded px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide',
                  last.mode === 'recorded' ? 'bg-iris/15 text-iris-soft' : 'bg-amber/12 text-amber-soft'
                )}
                title={
                  last.mode === 'recorded'
                    ? 'Saved to run history'
                    : 'Temporary run — kept until the next run, not in history'
                }
              >
                {last.mode}
              </span>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onHistory}
            title="Run history"
            className="no-drag flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            <History size={13} />
            {park.runs?.length ? park.runs.length : 'History'}
          </button>
          {running ? (
            <button
              onClick={onCancel}
              className="no-drag flex items-center gap-1.5 rounded-lg bg-rose/15 px-3 py-1.5 text-xs font-medium text-rose transition-colors hover:bg-rose/25"
            >
              <Square size={13} />
              Stop
            </button>
          ) : (
            <button
              onClick={onRun}
              className="no-drag flex items-center gap-1.5 rounded-lg bg-mint/15 px-3 py-1.5 text-xs font-medium text-mint transition-colors hover:bg-mint/25"
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Run now
            </button>
          )}
          <button
            onClick={onDelete}
            title="Delete this park"
            className="no-drag flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-ghost transition-colors hover:border-rose/40 hover:text-rose"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {park.objective && (
        <div className="flex items-start gap-2 rounded-lg border border-mint/20 bg-mint/[0.06] px-3 py-1.5">
          <Target size={13} className="mt-0.5 shrink-0 text-mint" />
          <div className="min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-wide text-mint">Objective</span>
            <p className="text-[12px] leading-snug text-ink-soft">{park.objective}</p>
          </div>
        </div>
      )}

      {park.parkKind === 'schedule' && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface/60 px-3 py-2">
          <Clock size={13} className="shrink-0 text-ink-faint" />
          <span className="shrink-0 text-[11px] text-ink-faint">Cron</span>
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 9 * * 1-5  (weekdays 9am)"
            className={clsx(
              'no-drag min-w-0 flex-1 rounded-md border bg-surface px-2 py-1 font-mono text-[12px] text-ink outline-none transition-colors',
              cronOk ? 'border-line focus:border-iris' : 'border-rose/50'
            )}
          />
          {!cronOk && <span className="shrink-0 text-[10px] text-rose">invalid</span>}
          <button
            disabled={!cronOk}
            onClick={() => onSchedule(cron.trim(), Boolean(cron.trim()))}
            className="no-drag shrink-0 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-soft transition-colors hover:border-line-strong disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={() => onSchedule(park.cron, !park.scheduleEnabled)}
            disabled={!park.cron}
            className={clsx(
              'no-drag shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40',
              park.scheduleEnabled ? 'bg-mint/15 text-mint' : 'border border-line bg-surface text-ink-soft hover:border-line-strong'
            )}
          >
            {park.scheduleEnabled ? 'Enabled' : 'Enable'}
          </button>
        </div>
      )}
    </div>
  )
}

