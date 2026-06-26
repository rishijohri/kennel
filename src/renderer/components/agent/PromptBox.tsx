import { useRef, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { ArrowUp, Square } from 'lucide-react'

export type StageAccent = 'mint' | 'iris' | 'blue'

/** Per-accent breathing-aura colour trio (CSS custom props for .prompt-aura). */
const AURA: Record<StageAccent, { '--aura-1': string; '--aura-2': string; '--aura-3': string }> = {
  mint: {
    '--aura-1': 'rgba(79, 214, 168, 0.55)',
    '--aura-2': 'rgba(86, 182, 255, 0.40)',
    '--aura-3': 'rgba(124, 108, 255, 0.42)'
  },
  iris: {
    '--aura-1': 'rgba(124, 108, 255, 0.58)',
    '--aura-2': 'rgba(86, 182, 255, 0.40)',
    '--aura-3': 'rgba(79, 214, 168, 0.34)'
  },
  blue: {
    '--aura-1': 'rgba(86, 182, 255, 0.55)',
    '--aura-2': 'rgba(124, 108, 255, 0.42)',
    '--aura-3': 'rgba(79, 214, 168, 0.32)'
  }
}

const SEND_BG: Record<StageAccent, string> = {
  mint: 'bg-mint text-base hover:bg-mint-soft',
  iris: 'bg-iris text-white hover:bg-iris-soft',
  blue: 'bg-[#56b6ff] text-base hover:brightness-110'
}

const RING: Record<StageAccent, string> = {
  mint: 'focus-within:border-mint/55',
  iris: 'focus-within:border-iris/55',
  blue: 'focus-within:border-[#56b6ff]/55'
}

/**
 * The breathing prompt box — a frosted, absolute-black input pill sitting on a
 * slowly pulsing multi-hue aura. Used for the agents' hero/docked composers and
 * the New Step wizard's prompt stage.
 */
export function PromptBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  accent = 'iris',
  size = 'hero',
  disabled = false,
  busy = false,
  onCancel,
  autoFocus = false,
  rows,
  belowAura,
  footer,
  className
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder?: string
  accent?: StageAccent
  size?: 'hero' | 'docked'
  disabled?: boolean
  busy?: boolean
  onCancel?: () => void
  autoFocus?: boolean
  /** Override textarea rows (defaults: hero 2, docked 1). */
  rows?: number
  /** Extra controls rendered between the aura and the box (e.g. autonomy picker). */
  belowAura?: ReactNode
  /** Small hint line under the box. */
  footer?: ReactNode
  className?: string
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const hero = size === 'hero'
  const canSend = !disabled && !busy && value.trim().length > 0

  return (
    <div className={clsx('relative w-full', className)}>
      <div className={clsx('prompt-aura', !hero && 'is-compact')} style={AURA[accent] as React.CSSProperties} />

      <div className="relative z-10">
        {belowAura}
        <div
          className={clsx(
            'no-drag flex items-end gap-2 border bg-black/70 backdrop-blur-xl transition-colors',
            'border-white/10 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)]',
            RING[accent],
            hero ? 'rounded-[26px] px-4 py-3' : 'rounded-2xl px-3 py-2'
          )}
          onClick={() => taRef.current?.focus()}
        >
          <textarea
            ref={taRef}
            autoFocus={autoFocus}
            value={value}
            disabled={disabled}
            rows={rows ?? (hero ? 2 : 1)}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (canSend) onSubmit()
              }
            }}
            placeholder={placeholder}
            className={clsx(
              'min-w-0 flex-1 resize-none bg-transparent leading-relaxed text-ink outline-none placeholder:text-ink-faint',
              hero ? 'px-1.5 py-1.5 text-[15px]' : 'px-1 py-1 text-[13.5px]'
            )}
          />
          {busy && onCancel ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCancel()
              }}
              title="Stop"
              className={clsx(
                'flex shrink-0 items-center justify-center rounded-full bg-rose/20 text-rose transition-colors hover:bg-rose/30',
                hero ? 'h-10 w-10' : 'h-8 w-8'
              )}
            >
              <Square size={hero ? 15 : 13} />
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (canSend) onSubmit()
              }}
              disabled={!canSend}
              title="Send"
              className={clsx(
                'flex shrink-0 items-center justify-center rounded-full transition-all active:scale-95 disabled:opacity-30',
                SEND_BG[accent],
                hero ? 'h-10 w-10' : 'h-8 w-8'
              )}
            >
              <ArrowUp size={hero ? 18 : 16} strokeWidth={2.5} />
            </button>
          )}
        </div>
        {footer && <div className="mt-2 px-1 text-center text-[11px] text-ink-faint">{footer}</div>}
      </div>
    </div>
  )
}
