import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { Code2, GitCompare, Columns2, Rows2, X, FileWarning } from 'lucide-react'
import type { NodeChange, NodeFileDiff } from '@shared/types'
import { Modal, Spinner } from '../ui'
import { ensureKennelTheme, languageForPath } from '../../lib/monaco'
import { STATUS_META } from './changeStatus'

const EDITOR_OPTS = {
  readOnly: true,
  domReadOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12.5,
  lineHeight: 19,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  renderLineHighlight: 'none' as const,
  automaticLayout: true,
  smoothScrolling: true,
  // No language services in a read-only viewer — avoids spinning up language workers.
  hover: { enabled: false },
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  parameterHints: { enabled: false },
  scrollbar: { useShadows: false, verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
  padding: { top: 12, bottom: 12 }
}

/**
 * Read-only file viewer. Shows a file's content (Monaco) and, for modified files,
 * a side-by-side/inline git-style diff (Monaco DiffEditor). Never editable.
 */
export function FileViewerModal({
  nodeId,
  change,
  onClose
}: {
  nodeId: string
  change: NodeChange
  onClose: () => void
}) {
  const [data, setData] = useState<NodeFileDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'code' | 'diff'>('code')
  const [sideBySide, setSideBySide] = useState(true)

  const lang = languageForPath(change.path)
  const meta = STATUS_META[change.status]

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    window.kennel
      .getNodeFileDiff(nodeId, change.path)
      .then((d) => {
        if (!alive) return
        setData(d)
        // Default to the diff when both sides exist (a real before→after change).
        setView(d && d.before !== null && d.after !== null ? 'diff' : 'code')
        setLoading(false)
      })
      .catch((e: any) => {
        if (!alive) return
        setError(e?.message ?? 'Failed to load file')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [nodeId, change.path])

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const canDiff = Boolean(data && data.before !== null && data.after !== null)
  const codeValue = data ? (data.after ?? data.before ?? '') : ''
  const fileName = change.path.split('/').pop()
  const dir = change.path.split('/').slice(0, -1).join('/')

  return (
    <Modal open onClose={onClose} className="flex h-[84vh] max-w-6xl flex-col bg-surface" labelledBy="fv-title">
      {/* Header */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <span
            className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold', meta.chip)}
            title={meta.label}
          >
            {change.status}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span id="fv-title" className="truncate text-[13px] font-medium text-ink">{fileName}</span>
              {change.oldPath && (
                <span className="truncate text-[11px] text-ink-faint">← {change.oldPath}</span>
              )}
            </div>
            {dir && <div className="truncate text-[10.5px] text-ink-ghost">{dir}</div>}
          </div>

          {/* Code / Diff toggle */}
          {canDiff && (
            <div className="flex items-center rounded-lg border border-line p-0.5 text-[11px]">
              <ToggleBtn active={view === 'code'} onClick={() => setView('code')} icon={<Code2 size={12} />}>
                Code
              </ToggleBtn>
              <ToggleBtn active={view === 'diff'} onClick={() => setView('diff')} icon={<GitCompare size={12} />}>
                Diff
              </ToggleBtn>
            </div>
          )}
          {view === 'diff' && canDiff && (
            <button
              onClick={() => setSideBySide((v) => !v)}
              title={sideBySide ? 'Switch to inline' : 'Switch to side-by-side'}
              className="rounded-md p-1.5 text-ink-soft hover:bg-surface-hover hover:text-ink"
            >
              {sideBySide ? <Rows2 size={15} /> : <Columns2 size={15} />}
            </button>
          )}
          <button
            autoFocus
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1.5 text-ink-soft hover:bg-surface-hover hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 bg-[#0a0b10]">
          {loading ? (
            <Centered>
              <Spinner size={18} />
            </Centered>
          ) : error ? (
            <Centered>{error}</Centered>
          ) : !data ? (
            <Centered>This file could not be loaded.</Centered>
          ) : data.binary ? (
            <Centered>
              <FileWarning size={20} className="mb-2 text-amber" />
              Binary or very large file — not shown.
            </Centered>
          ) : view === 'diff' && canDiff ? (
            <DiffEditor
              key={sideBySide ? 'sbs' : 'inline'}
              height="100%"
              theme="kennel-dark"
              language={lang}
              original={data.before ?? ''}
              modified={data.after ?? ''}
              beforeMount={ensureKennelTheme}
              loading={<Spinner size={18} />}
              options={{ ...EDITOR_OPTS, renderSideBySide: sideBySide, enableSplitViewResizing: true }}
            />
          ) : (
            <Editor
              height="100%"
              theme="kennel-dark"
              language={lang}
              value={codeValue}
              beforeMount={ensureKennelTheme}
              loading={<Spinner size={18} />}
              options={EDITOR_OPTS}
            />
          )}
        </div>
    </Modal>
  )
}

function ToggleBtn({
  active,
  onClick,
  icon,
  children
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1 rounded-md px-2 py-1 transition-colors',
        active ? 'bg-iris/15 text-ink' : 'text-ink-faint hover:text-ink-soft'
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center text-xs text-ink-faint">
      {children}
    </div>
  )
}
