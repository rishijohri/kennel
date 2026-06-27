import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Layers, ChevronsDownUp } from 'lucide-react'
import { useKennel } from '../../store/useKennel'

/** The synthetic "Collapsed Source" node shown above a focused subtree. Standing
 *  in for every hidden node; clicking it clears the focus and restores the canvas. */
export interface CollapsedNodeData {
  count: number
  activeInside: boolean
  runningInside: boolean
  [key: string]: unknown
}

function CollapsedNodeImpl({ data }: NodeProps) {
  const { count, activeInside, runningInside } = data as CollapsedNodeData
  const setFocusedNode = useKennel((s) => s.setFocusedNode)

  return (
    <div
      onClick={() => void setFocusedNode(null)}
      title="Expand — show the full canvas again"
      className="no-drag group relative w-[240px] cursor-pointer rounded-2xl border border-dashed border-line-strong bg-surface-overlay/80 px-4 py-3 shadow-node transition-all hover:border-iris hover:bg-surface-overlay"
    >
      {/* Stacked-cards hint that this is many nodes in one. */}
      <div className="pointer-events-none absolute -top-2 left-4 right-4 h-2.5 rounded-t-xl border border-b-0 border-dashed border-line/50 bg-surface-raised/50" />
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-iris/12 text-iris-soft">
          <Layers size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            Collapsed
            {runningInside && (
              <span
                title="A run is in progress on a hidden node"
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-iris-soft shadow-[0_0_0_3px_rgba(124,108,255,0.18)]"
              />
            )}
            {activeInside && (
              <span
                title="The checked-out node is hidden inside this collapse"
                className="h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_0_3px_rgba(79,214,168,0.16)]"
              />
            )}
          </div>
          <p className="text-[11px] text-ink-faint">
            {count} node{count === 1 ? '' : 's'} hidden · click to expand
          </p>
        </div>
        <ChevronsDownUp size={15} className="text-ink-ghost transition-colors group-hover:text-iris-soft" />
      </div>
      <Handle type="source" position={Position.Bottom} className="!bottom-[-5px]" />
    </div>
  )
}

export const CollapsedNode = memo(CollapsedNodeImpl)
