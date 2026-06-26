import { clsx } from 'clsx'
import { X } from 'lucide-react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from 'react'

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'

export function Button({
  variant = 'subtle',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    'no-drag inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium ' +
    'transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none select-none active:scale-[0.98]'
  const variants: Record<Variant, string> = {
    primary:
      'bg-iris text-white shadow-[0_6px_20px_-8px_rgba(124,108,255,0.9)] hover:bg-iris-soft',
    ghost: 'text-ink-soft hover:text-ink hover:bg-surface-hover',
    subtle:
      'bg-surface-overlay text-ink border border-line hover:border-line-strong hover:bg-surface-hover',
    danger: 'bg-rose/15 text-rose border border-rose/30 hover:bg-rose/25'
  }
  return (
    <button className={clsx(base, variants[variant], className)} {...rest}>
      {children}
    </button>
  )
}

export function IconButton({
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        'no-drag inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft',
        'transition-colors hover:bg-surface-hover hover:text-ink active:scale-95',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
      {children}
    </label>
  )
}

const fieldCls =
  'no-drag w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink ' +
  'placeholder:text-ink-ghost outline-none transition-colors focus:border-iris focus:ring-2 focus:ring-iris/25'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(fieldCls, props.className)} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(fieldCls, 'leading-relaxed', props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(fieldCls, 'appearance-none cursor-pointer pr-8', props.className)}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  accent
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  accent?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="no-drag flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-faint">{hint}</span>}
      </span>
      <span
        className={clsx(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? '' : 'bg-line-strong'
        )}
        style={checked ? { background: accent ?? 'var(--tw-iris, #7c6cff)' } : undefined}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5'
          )}
        />
      </span>
    </button>
  )
}

export function Badge({
  children,
  className,
  style
}: {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      style={style}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        className
      )}
    >
      {children}
    </span>
  )
}

export function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  labelledBy?: string
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className={clsx(
          'relative z-10 w-full overflow-hidden rounded-2xl border border-line glass shadow-panel animate-scale-in',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
  id
}: {
  title: string
  subtitle?: string
  onClose: () => void
  id?: string
}) {
  return (
    <div className="flex items-start justify-between border-b border-line px-6 py-4">
      <div>
        <h2 id={id} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
      </div>
      <IconButton onClick={onClose} aria-label="Close">
        <X size={16} />
      </IconButton>
    </div>
  )
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      className={clsx('inline-block animate-spin rounded-full border-2 border-current', className)}
      style={{
        width: size,
        height: size,
        borderTopColor: 'transparent'
      }}
    />
  )
}

export const EMOJIS = ['🧭', '💬', '🔧', '🛠️', '🔍', '🧪', '🚀', '🧠', '⚡', '🦴', '🐾', '📐', '🎯', '🪄']
export const COLORS = [
  '#7c6cff',
  '#4fd6a8',
  '#ffb454',
  '#ff6b8b',
  '#56b6ff',
  '#c678dd',
  '#e5c07b',
  '#98c379'
]
