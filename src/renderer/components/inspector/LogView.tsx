import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  Brain,
  ChevronRight,
  FileText,
  FolderTree,
  Search,
  FilePen,
  TerminalSquare,
  Check,
  X,
  CircleDot,
  CircleDashed,
  CheckCircle2
} from 'lucide-react'
import { EMPTY_LOG, useKennel, type LogEntry } from '../../store/useKennel'
import { Button } from '../ui'

const TOOL_ICON: Record<string, React.ReactNode> = {
  read_file: <FileText size={13} />,
  list_dir: <FolderTree size={13} />,
  search_code: <Search size={13} />,
  write_file: <FilePen size={13} />,
  edit_file: <FilePen size={13} />,
  run_bash: <TerminalSquare size={13} />
}

function toolSummary(tool: string, input: any): string {
  if (!input || typeof input !== 'object') return ''
  if (tool === 'run_bash') return input.command ?? ''
  if (tool === 'search_code') return input.query ?? ''
  return input.path ?? ''
}

export function LogView({ nodeId, isRunning }: { nodeId: string; isRunning: boolean }) {
  const logs = useKennel((s) => s.logs[nodeId]) ?? EMPTY_LOG
  const cancelRun = useKennel((s) => s.cancelRun)
  const loadNodeActivity = useKennel((s) => s.loadNodeActivity)
  const scrollRef = useRef<HTMLDivElement>(null)

  // After a restart the in-memory log is empty — rehydrate it from disk. Skips
  // automatically if a run is live or logs are already present (no clobber).
  useEffect(() => {
    if (!isRunning) void loadNodeActivity(nodeId)
  }, [nodeId, isRunning, loadNodeActivity])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  if (logs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ink-ghost">
        <CircleDashed size={22} className={isRunning ? 'animate-spin' : ''} />
        <p className="text-xs">
          {isRunning ? 'Waiting for the agent…' : 'No activity recorded for this node.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {logs.map((entry) => (
          <LogItem key={entry.id} entry={entry} />
        ))}
      </div>
      {isRunning && (
        <div className="border-t border-line/70 p-3">
          <Button variant="danger" className="w-full" onClick={() => cancelRun(nodeId)}>
            <X size={14} />
            Stop run
          </Button>
        </div>
      )}
    </div>
  )
}

function LogItem({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false)

  switch (entry.kind) {
    case 'status':
      return (
        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          <CircleDot size={11} className="text-iris-soft/70" />
          <span className="selectable">{entry.text}</span>
        </div>
      )

    case 'thinking':
      return (
        <button
          onClick={() => setOpen((o) => !o)}
          className="no-drag w-full rounded-xl border border-line/60 bg-surface/40 p-2.5 text-left"
        >
          <div className="flex items-center gap-2 text-[11px] font-medium text-ink-faint">
            <Brain size={13} className="text-iris-soft" />
            Thinking
            <ChevronRight
              size={12}
              className={clsx('ml-auto transition-transform', open && 'rotate-90')}
            />
          </div>
          {open && (
            <p className="selectable mt-2 whitespace-pre-wrap text-[12px] italic leading-relaxed text-ink-ghost">
              {entry.text}
            </p>
          )}
        </button>
      )

    case 'assistant':
      return (
        <div className="selectable whitespace-pre-wrap rounded-xl bg-surface/40 p-3 text-[13px] leading-relaxed text-ink-soft">
          {entry.text}
        </div>
      )

    case 'tool': {
      const summary = toolSummary(entry.tool, entry.input)
      const done = entry.ok !== undefined
      return (
        <div className="overflow-hidden rounded-xl border border-line/70 bg-surface/60">
          <button
            onClick={() => setOpen((o) => !o)}
            className="no-drag flex w-full items-center gap-2 px-3 py-2 text-left"
          >
            <span className="text-iris-soft">{TOOL_ICON[entry.tool] ?? <CircleDot size={13} />}</span>
            <span className="font-mono text-[12px] text-ink">{entry.tool}</span>
            {summary && (
              <span className="truncate font-mono text-[11px] text-ink-faint">{summary}</span>
            )}
            <span className="ml-auto">
              {!done ? (
                <CircleDashed size={13} className="animate-spin text-ink-faint" />
              ) : entry.ok ? (
                <Check size={13} className="text-mint" />
              ) : (
                <X size={13} className="text-rose" />
              )}
            </span>
          </button>
          {open && entry.preview && (
            <pre className="selectable max-h-48 overflow-auto border-t border-line/60 bg-base/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-faint">
              {entry.preview}
            </pre>
          )}
        </div>
      )
    }

    case 'output':
      return (
        <pre
          className={clsx(
            'selectable max-h-56 overflow-auto rounded-xl bg-base/60 px-3 py-2 font-mono text-[11px] leading-relaxed',
            entry.stream === 'stderr' ? 'text-rose-soft' : 'text-ink-soft'
          )}
        >
          {entry.text}
        </pre>
      )

    case 'error':
      return (
        <div className="selectable flex items-start gap-2 rounded-xl border border-rose/30 bg-rose/10 p-3 text-[12px] text-rose-soft">
          <X size={14} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{entry.text}</span>
        </div>
      )

    case 'done':
      return (
        <div className="flex items-center gap-2 rounded-xl border border-mint/25 bg-mint/10 p-3 text-[12px] text-mint">
          <CheckCircle2 size={14} />
          <span className="selectable">{entry.text}</span>
        </div>
      )
  }
}
