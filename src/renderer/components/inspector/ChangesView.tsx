import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronRight } from 'lucide-react'
import type { NodeChange } from '@shared/types'
import { Spinner } from '../ui'
import { STATUS_META } from './changeStatus'
import { FileViewerModal } from './FileViewerModal'

/**
 * Lists the files a node changed vs its parent, each with a git status letter
 * (A/M/D/R…). Clicking a file opens a read-only Monaco viewer + diff.
 */
export function ChangesView({ nodeId, isRoot }: { nodeId: string; isRoot: boolean }) {
  const [changes, setChanges] = useState<NodeChange[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<NodeChange | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setOpen(null)
    window.kennel
      .getNodeChanges(nodeId)
      .then((c) => {
        if (!alive) return
        setChanges(c)
        setLoading(false)
      })
      .catch((e: any) => {
        if (!alive) return
        setError(e?.message ?? 'Failed to load changes')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [nodeId])

  if (isRoot) {
    return <Centered>This is the root codebase — there is no parent to compare against.</Centered>
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        <Spinner size={18} />
      </div>
    )
  }
  if (error) return <Centered>{error}</Centered>
  if (!changes || changes.length === 0) {
    return <Centered>No files changed relative to the parent node.</Centered>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
        {changes.length} file{changes.length === 1 ? '' : 's'} changed
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {changes.map((c) => {
          const meta = STATUS_META[c.status]
          const name = c.path.split('/').pop()
          const dir = c.path.split('/').slice(0, -1).join('/')
          return (
            <button
              key={c.path}
              onClick={() => setOpen(c)}
              title={`${meta.label} · ${c.path}`}
              className="group flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition-colors hover:bg-surface"
            >
              <span
                className={clsx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10.5px] font-bold',
                  meta.chip
                )}
              >
                {c.status}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="truncate text-[13px] text-ink-soft group-hover:text-ink">{name}</span>
                  {c.oldPath && (
                    <span className="shrink-0 truncate text-[10px] text-ink-ghost">
                      ← {c.oldPath.split('/').pop()}
                    </span>
                  )}
                </span>
                {dir && <span className="block truncate text-[10.5px] text-ink-ghost">{dir}</span>}
              </span>
              <ChevronRight size={14} className="shrink-0 text-ink-ghost opacity-0 group-hover:opacity-100" />
            </button>
          )
        })}
      </div>

      {open && <FileViewerModal nodeId={nodeId} change={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center text-xs text-ink-ghost">
      {children}
    </div>
  )
}
