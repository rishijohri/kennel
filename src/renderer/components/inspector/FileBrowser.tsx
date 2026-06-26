import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import type { FileNodeTree } from '@shared/types'
import { Spinner } from '../ui'
import { CodeViewer } from './CodeViewer'

export function FileBrowser({ nodeId }: { nodeId: string }) {
  const [tree, setTree] = useState<FileNodeTree | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const reqRef = useRef(0) // guards against out-of-order getFileContent responses

  useEffect(() => {
    let alive = true
    setLoading(true)
    setSelected(null)
    setContent('')
    window.kennel
      .getFileTree(nodeId)
      .then((t) => {
        if (!alive) return
        setTree(t)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setTree(null)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [nodeId])

  const openFile = async (path: string) => {
    setSelected(path)
    setLoadingFile(true)
    const req = ++reqRef.current
    try {
      const text = await window.kennel.getFileContent(nodeId, path)
      if (req !== reqRef.current) return // a newer file was clicked — ignore stale result
      setContent(text)
    } catch (e: any) {
      if (req !== reqRef.current) return
      setContent(`// Failed to load file: ${e?.message ?? 'unknown error'}`)
    } finally {
      if (req === reqRef.current) setLoadingFile(false)
    }
  }

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        <Spinner size={18} />
      </div>
    )
  }

  if (!tree || !tree.children?.length) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-ghost">
        This snapshot has no tracked files.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-[0_0_42%] overflow-y-auto border-b border-line/70 p-2">
        <TreeLevel
          nodes={tree.children}
          depth={0}
          expanded={expanded}
          selected={selected}
          onToggle={toggle}
          onOpen={openFile}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="flex items-center gap-1.5 border-b border-line/50 px-3 py-1.5 text-[11px] text-ink-faint">
              <File size={11} />
              <span className="truncate font-mono">{selected}</span>
            </div>
            <div className="min-h-0 flex-1 bg-[#0a0b10]">
              {loadingFile ? (
                <div className="flex h-full items-center justify-center text-ink-faint">
                  <Spinner size={16} />
                </div>
              ) : content === '' ? (
                <div className="p-4 text-xs text-ink-ghost">Empty file.</div>
              ) : (
                <CodeViewer path={selected} content={content} />
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink-ghost">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  )
}

function TreeLevel({
  nodes,
  depth,
  expanded,
  selected,
  onToggle,
  onOpen
}: {
  nodes: FileNodeTree[]
  depth: number
  expanded: Set<string>
  selected: string | null
  onToggle: (p: string) => void
  onOpen: (p: string) => void
}) {
  return (
    <div>
      {nodes.map((n) => {
        const isOpen = expanded.has(n.path)
        return (
          <div key={n.path}>
            <button
              onClick={() => (n.isDir ? onToggle(n.path) : onOpen(n.path))}
              className={clsx(
                'no-drag flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12.5px] transition-colors',
                selected === n.path
                  ? 'bg-iris/15 text-ink'
                  : 'text-ink-soft hover:bg-surface-hover'
              )}
              style={{ paddingLeft: depth * 12 + 6 }}
            >
              {n.isDir ? (
                <>
                  <ChevronRight
                    size={12}
                    className={clsx('shrink-0 text-ink-ghost transition-transform', isOpen && 'rotate-90')}
                  />
                  {isOpen ? (
                    <FolderOpen size={13} className="shrink-0 text-iris-soft/80" />
                  ) : (
                    <Folder size={13} className="shrink-0 text-iris-soft/70" />
                  )}
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <File size={13} className="shrink-0 text-ink-ghost" />
                </>
              )}
              <span className="truncate">{n.name}</span>
            </button>
            {n.isDir && isOpen && n.children && (
              <TreeLevel
                nodes={n.children}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

