import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowLeft, Check, AlertTriangle, FileText, File, SkipForward } from 'lucide-react'
import type { FileNodeTree, Park, WorkflowRun } from '@shared/types'
import { Modal, Spinner } from '../ui'
import { CodeViewer } from '../inspector/CodeViewer'

function flatten(tree: FileNodeTree | null): { path: string; name: string }[] {
  if (!tree) return []
  const out: { path: string; name: string }[] = []
  const walk = (n: FileNodeTree) => {
    if (!n.isDir) out.push({ path: n.path, name: n.path })
    n.children?.forEach(walk)
  }
  tree.children?.forEach(walk)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function RunHistory({ park, onClose }: { park: Park; onClose: () => void }) {
  const runs = park.runs ?? []
  const [selectedId, setSelectedId] = useState<string | null>(runs[0]?.id ?? null)
  const selected = runs.find((r) => r.id === selectedId) ?? null

  return (
    <Modal open onClose={onClose} className="flex h-[82vh] max-w-5xl flex-col bg-surface" labelledBy="history-title">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h2 id="history-title" className="text-sm font-semibold text-ink">
            {park.name} — run history
          </h2>
          <p className="text-[11px] text-ink-faint">
            {runs.length} recorded run{runs.length === 1 ? '' : 's'} · temporary runs aren’t kept
          </p>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-xs text-ink-faint">
          No recorded runs yet. Choose “Recorded” when you run this workflow to keep it here.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Run list */}
          <div className="w-56 shrink-0 overflow-auto border-r border-line">
            {runs.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={clsx(
                  'flex w-full flex-col gap-0.5 border-b border-line/60 px-3 py-2.5 text-left transition-colors',
                  r.id === selectedId ? 'bg-surface-hover' : 'hover:bg-surface-hover/50'
                )}
              >
                <div className="flex items-center gap-1.5">
                  <RunStatusDot run={r} />
                  <span className="text-[12px] font-medium text-ink">{fmtTime(r.startedAt)}</span>
                </div>
                <span className="text-[10.5px] capitalize text-ink-ghost">
                  {r.trigger} · {r.status}
                </span>
              </button>
            ))}
          </div>

          {/* Detail */}
          <div className="min-w-0 flex-1">{selected && <RunDetail park={park} run={selected} />}</div>
        </div>
      )}
    </Modal>
  )
}

function RunStatusDot({ run }: { run: WorkflowRun }) {
  const cls =
    run.status === 'error' ? 'bg-rose' : run.status === 'running' ? 'bg-iris-soft' : 'bg-mint'
  return <span className={clsx('h-2 w-2 shrink-0 rounded-full', cls)} />
}

function RunDetail({ park, run }: { park: Park; run: WorkflowRun }) {
  const [files, setFiles] = useState<{ path: string; name: string }[] | null>(null)
  const [viewing, setViewing] = useState<{ path: string; content: string } | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)

  useEffect(() => {
    let alive = true
    setFiles(null)
    setViewing(null)
    window.kennel
      .getRunWorkspaceTree(park.id, run.id)
      .then((tree) => alive && setFiles(flatten(tree)))
      .catch(() => alive && setFiles([]))
    return () => {
      alive = false
    }
  }, [park.id, run.id])

  const openFile = async (path: string) => {
    setLoadingFile(true)
    try {
      const content = await window.kennel.getRunWorkspaceFile(park.id, run.id, path)
      setViewing({ path, content })
    } catch {
      setViewing({ path, content: '(could not read file)' })
    } finally {
      setLoadingFile(false)
    }
  }

  const results = run.results ?? []

  if (viewing) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <button
            onClick={() => setViewing(null)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-soft hover:bg-surface-hover hover:text-ink"
          >
            <ArrowLeft size={13} /> Back
          </button>
          <span className="truncate font-mono text-[11px] text-ink-faint">{viewing.path}</span>
        </div>
        <div className="min-h-0 flex-1 bg-[#0a0b10]">
          <CodeViewer path={viewing.path} content={viewing.content} />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      {run.error && (
        <div className="rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-[12px] text-rose">
          {run.error}
        </div>
      )}

      {run.report && (
        <Section icon={<FileText size={13} />} label="Report">
          <div className="selectable max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface/60 p-3 text-[12px] leading-relaxed text-ink-soft">
            {run.report}
          </div>
        </Section>
      )}

      <Section label="Steps">
        <div className="overflow-hidden rounded-lg border border-line">
          {results.map((r, i) => (
            <div
              key={r.nodeId}
              className={clsx('flex items-center gap-2 px-3 py-2 text-[12px]', i > 0 && 'border-t border-line/60')}
            >
              <StepStatusIcon status={r.status} kind={r.resultStateKind} />
              <span className="min-w-0 flex-1 truncate text-ink">{r.title}</span>
              {r.activated === false && (
                <span className="rounded bg-amber/12 px-1.5 py-0.5 text-[10px] text-amber-soft">branch off</span>
              )}
              {r.resultState && r.status !== 'skipped' && (
                <span className="truncate text-[10.5px] text-ink-ghost">{r.resultState}</span>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section label="Workspace files">
        {files === null ? (
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            <Spinner size={12} /> loading…
          </div>
        ) : files.length === 0 ? (
          <p className="text-xs text-ink-ghost">This run produced no workspace files.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {files.map((f, i) => (
              <button
                key={f.path}
                onClick={() => void openFile(f.path)}
                disabled={loadingFile}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] text-ink-faint hover:bg-surface-hover hover:text-ink',
                  i > 0 && 'border-t border-line/60'
                )}
              >
                <File size={12} className="shrink-0 text-ink-ghost" />
                <span className="truncate">{f.path}</span>
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function StepStatusIcon({ status, kind }: { status: string; kind?: string }) {
  if (status === 'skipped') return <SkipForward size={13} className="shrink-0 text-amber-soft" />
  if (status === 'error' || kind === 'failure')
    return <AlertTriangle size={13} className="shrink-0 text-rose" />
  return <Check size={13} className="shrink-0 text-mint" />
}

function Section({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-ghost">
        {icon}
        {label}
      </div>
      {children}
    </div>
  )
}
