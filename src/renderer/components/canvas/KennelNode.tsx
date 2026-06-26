import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { clsx } from 'clsx'
import {
  Plus,
  Box,
  Sparkles,
  TerminalSquare,
  Check,
  AlertTriangle,
  FileDiff,
  Workflow,
  ArrowRight,
  Clock,
  Zap
} from 'lucide-react'
import type { AgentPersona, CanvasNode } from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { Spinner } from '../ui'

const PARK_ACCENT = '#56b6ff'

export interface KennelNodeData {
  node: CanvasNode
  persona?: AgentPersona
  isSelected: boolean
  isActive: boolean
  isRunning: boolean
  [key: string]: unknown
}

function KindIcon({ node, persona }: { node: CanvasNode; persona?: AgentPersona }) {
  if (node.kind === 'root')
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-iris/15 text-iris-soft">
        <Box size={17} />
      </div>
    )
  if (node.kind === 'deterministic')
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber/15 text-amber">
        <TerminalSquare size={17} />
      </div>
    )
  if (node.kind === 'park')
    return (
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ background: `${PARK_ACCENT}22`, boxShadow: `inset 0 0 0 1px ${PARK_ACCENT}55`, color: PARK_ACCENT }}
      >
        <Workflow size={17} />
      </div>
    )
  return (
    <div
      className="flex h-9 w-9 items-center justify-center rounded-lg text-base"
      style={{
        background: `${persona?.color ?? '#7c6cff'}22`,
        boxShadow: `inset 0 0 0 1px ${persona?.color ?? '#7c6cff'}55`
      }}
    >
      {persona?.emoji ?? <Sparkles size={16} />}
    </div>
  )
}

const RESULT_STYLE: Record<string, string> = {
  success: 'bg-mint/12 text-mint',
  failure: 'bg-rose/15 text-rose',
  neutral: 'bg-amber/12 text-amber-soft'
}

function StatusPill({ node, isRunning }: { node: CanvasNode; isRunning: boolean }) {
  if (isRunning || node.status === 'running')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-iris/15 px-2 py-0.5 text-[10px] font-medium text-iris-soft">
        <Spinner size={9} /> running
      </span>
    )
  // Deterministic nodes show their inferred result state.
  if (node.resultState)
    return (
      <span
        className={
          'inline-flex max-w-[120px] items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-medium ' +
          (RESULT_STYLE[node.resultStateKind ?? 'neutral'] ?? RESULT_STYLE.neutral)
        }
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
  if (node.kind === 'park')
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
        style={{ background: `${PARK_ACCENT}1f`, color: PARK_ACCENT }}
      >
        {node.parkKind === 'schedule' ? <Clock size={10} /> : <Zap size={10} />}
        {node.parkKind === 'schedule' ? 'scheduled' : 'trigger'}
      </span>
    )
  if (node.kind === 'root') return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-mint/12 px-2 py-0.5 text-[10px] font-medium text-mint">
      <Check size={10} /> done
    </span>
  )
}

function KennelNodeImpl({ data }: NodeProps) {
  const { node, persona, isSelected, isActive, isRunning } = data as KennelNodeData
  const openLauncher = useKennel((s) => s.openLauncher)
  const openPark = useKennel((s) => s.openPark)

  const accent =
    node.kind === 'agentic'
      ? persona?.color ?? '#7c6cff'
      : node.kind === 'deterministic'
        ? '#ffb454'
        : node.kind === 'park'
          ? PARK_ACCENT
          : '#7c6cff'

  return (
    <div
      className={clsx(
        'group relative w-[260px] rounded-2xl border bg-surface-raised/95 shadow-node transition-all duration-150',
        isSelected
          ? 'border-transparent ring-2'
          : isActive
            ? 'border-mint/45'
            : 'border-line hover:border-line-strong'
      )}
      style={isSelected ? ({ '--tw-ring-color': accent } as React.CSSProperties) : undefined}
    >
      <Handle type="target" position={Position.Top} className="!top-[-5px]" />

      <div className="flex items-start gap-3 p-3.5">
        <KindIcon node={node} persona={persona} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-ink">{node.title}</span>
            <StatusPill node={node} isRunning={isRunning} />
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] capitalize text-ink-ghost">
            {node.kind === 'root' ? 'codebase' : node.kind}
            {isActive && (
              <span
                title="Checked out — your folder reflects this state"
                className="inline-flex items-center gap-1 normal-case text-mint"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_0_3px_rgba(79,214,168,0.16)]" />
                checked out
              </span>
            )}
          </p>
        </div>
      </div>

      {(node.prompt || node.command || node.summary) && (
        <div className="px-3.5 pb-3">
          <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-faint">
            {node.prompt ?? node.command ?? node.summary}
          </p>
        </div>
      )}

      {node.diffStat && node.diffStat.filesChanged > 0 && (
        <div className="flex items-center gap-2 border-t border-line/70 px-3.5 py-2 text-[10px]">
          <FileDiff size={11} className="text-ink-ghost" />
          <span className="text-ink-faint">{node.diffStat.filesChanged}f</span>
          <span className="text-mint">+{node.diffStat.insertions}</span>
          <span className="text-rose">−{node.diffStat.deletions}</span>
        </div>
      )}

      {node.kind === 'park' && (
        <div className="px-3.5 pb-3">
          <button
            onClick={(e) => {
              e.stopPropagation()
              openPark(node.id)
            }}
            className="no-drag flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors"
            style={{ background: `${PARK_ACCENT}18`, color: PARK_ACCENT, boxShadow: `inset 0 0 0 1px ${PARK_ACCENT}40` }}
          >
            Open workflow
            <ArrowRight size={12} />
          </button>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bottom-[-5px]" />

      {/* Branch button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          openLauncher(node.id)
        }}
        title="Build a new step from here"
        className="no-drag absolute -bottom-3.5 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border border-line-strong bg-surface-overlay text-ink-soft opacity-0 shadow-node transition-all hover:scale-110 hover:border-iris hover:text-iris-soft group-hover:opacity-100"
        style={{ pointerEvents: 'all' }}
      >
        <Plus size={15} />
      </button>
    </div>
  )
}

export const KennelNode = memo(KennelNodeImpl)
