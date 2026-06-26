import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Loader2, Check, X, Wrench, Sparkles, CircleDashed, ArrowRight, Settings2 } from 'lucide-react'
import type { CaretakerStream } from '../../store/useKennel'
import { AgentStage, type StageHistory } from './AgentStage'
import { PromptBox, type StageAccent } from './PromptBox'

const ACCENT_TEXT: Record<StageAccent, string> = {
  mint: 'text-mint',
  iris: 'text-iris-soft',
  blue: 'text-[#7fc4ff]'
}
const ACCENT_SOFT_BG: Record<StageAccent, string> = {
  mint: 'border-mint/25 bg-mint/[0.08] text-mint',
  iris: 'border-iris/25 bg-iris/[0.08] text-iris-soft',
  blue: 'border-[#56b6ff]/25 bg-[#56b6ff]/[0.08] text-[#7fc4ff]'
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Shared chat experience for the Walker and Care Taker. Empty state centres the
 * agent sign + name above a big breathing prompt box (Gemini-style); once a
 * conversation starts, the prompt box docks to the bottom and shrinks while the
 * centred transcript scrolls above it.
 */
export function AgentChatStage({
  open,
  onClose,
  icon,
  name,
  tagline,
  accent,
  labelledBy,
  configured,
  history,
  messages,
  stream,
  busyHere,
  busyElsewhere,
  input,
  onInput,
  onSend,
  onCancel,
  onOpenRunning,
  placeholder,
  emptyHint,
  notConfiguredLabel,
  configSlot,
  composerExtras,
  banner
}: {
  open: boolean
  onClose: () => void
  icon: string
  name: string
  tagline: string
  accent: StageAccent
  labelledBy?: string
  configured: boolean
  history: StageHistory
  messages: ChatMessage[]
  stream: CaretakerStream | null
  busyHere: boolean
  busyElsewhere: boolean
  input: string
  onInput: (v: string) => void
  onSend: () => void
  onCancel: () => void
  onOpenRunning: () => void
  placeholder: string
  emptyHint: ReactNode
  notConfiguredLabel: string
  /** Provider/model config row, shown when the gear is toggled or unconfigured. */
  configSlot: ReactNode
  /** Extra composer controls (e.g. Walker autonomy), rendered above the input. */
  composerExtras?: ReactNode
  /** Contextual banner (e.g. Walker building a Park). */
  banner?: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showConfig, setShowConfig] = useState(false)

  const hasConversation = messages.length > 0 || Boolean(busyHere && stream)

  useEffect(() => {
    if (!configured && open) setShowConfig(true)
  }, [configured, open])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, stream])

  const composer = (() => {
    if (!configured) {
      return (
        <button
          onClick={() => setShowConfig(true)}
          className="no-drag w-full rounded-2xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber-soft"
        >
          {notConfiguredLabel}
        </button>
      )
    }
    if (busyElsewhere) {
      return (
        <button
          onClick={onOpenRunning}
          className={clsx(
            'no-drag flex w-full items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-sm',
            ACCENT_SOFT_BG[accent]
          )}
        >
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            {name} is working in another conversation
          </span>
          <span className="flex items-center gap-1 text-xs">
            Open it <ArrowRight size={13} />
          </span>
        </button>
      )
    }
    return (
      <PromptBox
        value={input}
        onChange={onInput}
        onSubmit={onSend}
        placeholder={placeholder}
        accent={accent}
        size={hasConversation ? 'docked' : 'hero'}
        busy={busyHere}
        onCancel={onCancel}
        autoFocus
        belowAura={composerExtras ? <div className="mb-2.5">{composerExtras}</div> : undefined}
      />
    )
  })()

  const configToggle = configured ? (
    <button
      onClick={() => setShowConfig((v) => !v)}
      title="Provider & model"
      className={clsx(
        'no-drag flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/40 backdrop-blur-md transition-colors hover:border-white/20 hover:bg-black/55',
        showConfig ? 'text-ink' : 'text-ink-soft'
      )}
    >
      <Settings2 size={16} />
    </button>
  ) : undefined

  const configOverlay = showConfig ? (
    <div className="absolute right-7 top-[72px] z-40 w-[380px] max-w-[calc(100vw-3.5rem)] animate-fly-down rounded-2xl border border-white/10 bg-black/85 p-4 shadow-panel backdrop-blur-xl">
      {configSlot}
    </div>
  ) : undefined

  return (
    <AgentStage
      open={open}
      onClose={onClose}
      accent={accent}
      history={history}
      topRight={configToggle}
      overlay={configOverlay}
      labelledBy={labelledBy}
    >
      {!hasConversation ? (
        // ── Hero: sign + name above the big breathing prompt box ──
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10">
          <div className="flex w-full max-w-[640px] flex-col items-center">
            <img
              src={icon}
              alt={name}
              className="h-16 w-16 animate-rise-in rounded-3xl object-cover shadow-[0_10px_40px_-12px_rgba(0,0,0,0.8)]"
            />
            <h2 id={labelledBy} className="mt-4 animate-rise-in text-2xl font-semibold tracking-tight text-ink">
              {name}
            </h2>
            <p className="mt-1.5 max-w-md animate-rise-in text-center text-sm leading-relaxed text-ink-faint">
              {tagline}
            </p>

            {banner && <div className="mt-5 w-full animate-rise-in">{banner}</div>}

            <div className="mt-7 w-full animate-rise-in">{composer}</div>

            {configured && !busyElsewhere && emptyHint && (
              <div className="mt-6 max-w-lg animate-fade-in text-center text-[12.5px] leading-relaxed text-ink-ghost">
                {emptyHint}
              </div>
            )}
          </div>
        </div>
      ) : (
        // ── Active: centred transcript above a docked, shrunk prompt box ──
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-24">
            <div className="mx-auto w-full max-w-[720px] space-y-5 pb-6">
              {messages.map((m, i) => (
                <Bubble key={i} role={m.role} text={m.content} icon={icon} name={name} />
              ))}
              {busyHere && stream && <StreamBubble stream={stream} icon={icon} name={name} accent={accent} />}
            </div>
          </div>
          <div className="shrink-0 px-6 pb-7 pt-2">
            <div className="mx-auto w-full max-w-[720px] animate-dock-in">
              {banner && <div className="mb-2.5">{banner}</div>}
              {composer}
            </div>
          </div>
        </>
      )}
    </AgentStage>
  )
}

function Bubble({
  role,
  text,
  icon,
  name
}: {
  role: 'user' | 'assistant'
  text: string
  icon: string
  name: string
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="selectable max-w-[82%] whitespace-pre-wrap rounded-3xl rounded-br-lg border border-white/[0.07] bg-black px-4 py-3 text-[13.5px] leading-relaxed text-ink shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9)]">
          {text}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-3">
      <img src={icon} alt={name} className="mt-0.5 h-7 w-7 shrink-0 rounded-lg object-cover" />
      <div className="selectable max-w-[86%] whitespace-pre-wrap rounded-3xl rounded-tl-lg border border-white/[0.06] bg-black px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9)]">
        {text}
      </div>
    </div>
  )
}

function StreamBubble({
  stream,
  icon,
  name,
  accent
}: {
  stream: CaretakerStream
  icon: string
  name: string
  accent: StageAccent
}) {
  return (
    <div className="flex gap-3">
      <img src={icon} alt={name} className="mt-0.5 h-7 w-7 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 max-w-[86%] space-y-2">
        {stream.tools.map((t, i) => (
          <div
            key={t.callId ?? i}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black px-2.5 py-1 text-[11px] text-ink-soft"
          >
            <Wrench size={11} className={ACCENT_TEXT[accent]} />
            <span className="font-mono">{t.tool}</span>
            {t.ok === undefined ? (
              <CircleDashed size={11} className="animate-spin text-ink-faint" />
            ) : t.ok ? (
              <Check size={11} className="text-mint" />
            ) : (
              <X size={11} className="text-rose" />
            )}
          </div>
        ))}
        {stream.text ? (
          <div className="selectable whitespace-pre-wrap rounded-3xl rounded-tl-lg border border-white/[0.06] bg-black px-4 py-3 text-[13.5px] leading-relaxed text-ink-soft shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9)]">
            {stream.text}
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-3xl border border-white/[0.06] bg-black px-4 py-3 text-[12px] text-ink-faint">
            {stream.thinking ? (
              <Sparkles size={13} className={ACCENT_TEXT[accent]} />
            ) : (
              <Loader2 size={13} className="animate-spin" />
            )}
            {stream.status || (stream.thinking ? 'Thinking…' : 'Working…')}
          </div>
        )}
      </div>
    </div>
  )
}
