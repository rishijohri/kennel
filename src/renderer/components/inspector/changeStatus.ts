import type { NodeChange } from '@shared/types'

/** Per-status label + accent classes for the status chip (A/M/D/R/C/T). */
export const STATUS_META: Record<NodeChange['status'], { label: string; chip: string; dot: string }> = {
  A: { label: 'Added', chip: 'bg-mint/15 text-mint', dot: 'text-mint' },
  M: { label: 'Modified', chip: 'bg-amber/15 text-amber-soft', dot: 'text-amber-soft' },
  D: { label: 'Deleted', chip: 'bg-rose/15 text-rose-soft', dot: 'text-rose-soft' },
  R: { label: 'Renamed', chip: 'bg-iris/15 text-iris-soft', dot: 'text-iris-soft' },
  C: { label: 'Copied', chip: 'bg-iris/15 text-iris-soft', dot: 'text-iris-soft' },
  T: { label: 'Type changed', chip: 'bg-ink-faint/15 text-ink-soft', dot: 'text-ink-soft' }
}
