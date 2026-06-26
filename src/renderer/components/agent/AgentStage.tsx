import { useEffect, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { X, History, Plus, Trash2, Loader2, MessageSquare } from 'lucide-react'
import type { AgentChat } from '@shared/types'
import type { StageAccent } from './PromptBox'

const ACCENT_TEXT: Record<StageAccent, string> = {
  mint: 'text-mint',
  iris: 'text-iris-soft',
  blue: 'text-[#7fc4ff]'
}
const ACCENT_ACTIVE: Record<StageAccent, string> = {
  mint: 'border-mint/50 bg-mint/10',
  iris: 'border-iris/50 bg-iris/10',
  blue: 'border-[#56b6ff]/50 bg-[#56b6ff]/10'
}

export interface StageHistory {
  chats: AgentChat[]
  activeChatId: string | null
  runningChatId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

/**
 * Full-screen frosted "stage" that replaces the boxed Modal for the agents and
 * the New Step wizard. The real canvas is barely felt behind a strong blur; the
 * content floats directly on the scrim. A History affordance sits at the general
 * top-left, the close affordance at the general top-right (both inset from the
 * absolute corners, per the design).
 */
export function AgentStage({
  open,
  onClose,
  accent,
  history,
  topRight,
  overlay,
  labelledBy,
  children
}: {
  open: boolean
  onClose: () => void
  accent: StageAccent
  history?: StageHistory
  /** Extra control(s) rendered in the top-right cluster, left of Close. */
  topRight?: ReactNode
  /** Floating panel rendered at the stage root (escapes the content stacking context). */
  overlay?: ReactNode
  labelledBy?: string
  children: ReactNode
}) {
  const [histOpen, setHistOpen] = useState(false)

  // Reset the history flyout whenever the stage (re)opens.
  useEffect(() => {
    if (open) setHistOpen(false)
  }, [open])

  // Esc closes the flyout first, then the stage. Re-bind when either changes so
  // the handler never reads a stale `histOpen`/`onClose`.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (histOpen) setHistOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, histOpen, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div className="absolute inset-0 frost-scrim animate-fade-in" onClick={onClose} />

      {/* Top affordances — inset from the absolute corners */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-7 py-6">
        <div className="pointer-events-auto">
          {history && (
            <button
              onClick={() => setHistOpen((v) => !v)}
              title="Conversation history"
              className={clsx(
                'no-drag flex h-10 items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3.5 text-sm backdrop-blur-md transition-colors hover:border-white/20 hover:bg-black/55',
                histOpen ? 'text-ink' : 'text-ink-soft'
              )}
            >
              <History size={16} className={histOpen ? ACCENT_TEXT[accent] : undefined} />
              <span className="hidden sm:inline">History</span>
              {history.runningChatId && (
                <Loader2 size={13} className={clsx('animate-spin', ACCENT_TEXT[accent])} />
              )}
            </button>
          )}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          {topRight}
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="no-drag flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 text-ink-soft backdrop-blur-md transition-colors hover:border-white/20 hover:bg-black/55 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {history && histOpen && (
        <HistoryFlyout
          accent={accent}
          history={history}
          onClose={() => setHistOpen(false)}
        />
      )}

      {overlay}

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden">{children}</div>
    </div>
  )
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return `${Math.floor(d / 7)}w ago`
}

function HistoryFlyout({
  accent,
  history,
  onClose
}: {
  accent: StageAccent
  history: StageHistory
  onClose: () => void
}) {
  const { chats, activeChatId, runningChatId } = history
  return (
    <div className="absolute left-7 top-[72px] z-30 w-72 origin-top-left animate-fly-down">
      <div className="flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/80 shadow-panel backdrop-blur-xl">
        <div className="flex items-center justify-between px-3.5 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Conversations
          </span>
          <button
            onClick={() => {
              history.onNew()
              onClose()
            }}
            title="New conversation"
            className="no-drag flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-ink-soft transition-colors hover:bg-white/5 hover:text-ink"
          >
            <Plus size={13} /> New
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {chats.length === 0 && (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-ink-ghost">
              No conversations yet. Start one — it’s saved here and keeps running even if you close
              this window.
            </p>
          )}
          {chats.map((c) => {
            const active = c.id === activeChatId
            const running = c.id === runningChatId
            return (
              <div
                key={c.id}
                onClick={() => {
                  history.onSelect(c.id)
                  onClose()
                }}
                className={clsx(
                  'no-drag group relative cursor-pointer rounded-xl border px-2.5 py-2 transition-colors',
                  active ? ACCENT_ACTIVE[accent] : 'border-transparent hover:bg-white/5'
                )}
              >
                <div className="flex items-center gap-2">
                  {running ? (
                    <Loader2 size={12} className={clsx('shrink-0 animate-spin', ACCENT_TEXT[accent])} />
                  ) : (
                    <MessageSquare size={12} className="shrink-0 text-ink-ghost" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink" title={c.title}>
                    {c.title}
                  </span>
                  {!running && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        history.onDelete(c.id)
                      }}
                      title="Delete conversation"
                      className="no-drag shrink-0 rounded p-0.5 text-ink-ghost opacity-0 transition-opacity hover:text-rose group-hover:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 pl-[20px] text-[10px] text-ink-ghost">
                  <span>{ago(c.updatedAt)}</span>
                  {c.messages.length > 0 && (
                    <>
                      <span>·</span>
                      <span>
                        {c.messages.length} msg{c.messages.length === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                  {running && (
                    <>
                      <span>·</span>
                      <span className={ACCENT_TEXT[accent]}>running</span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
