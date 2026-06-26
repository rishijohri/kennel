import { clsx } from 'clsx'

/**
 * Gemini-style floating-label field. The label sits as a placeholder when empty
 * and floats up (small, uppercase) on focus or once filled. Works for single and
 * multi-line; the surface is absolute-black to match the frosted stage.
 */
export function FloatingField({
  label,
  value,
  onChange,
  multiline = false,
  mono = false,
  rows = 3,
  autoFocus = false,
  onSubmit,
  className
}: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  mono?: boolean
  rows?: number
  autoFocus?: boolean
  /** Cmd/Ctrl+Enter submit. */
  onSubmit?: () => void
  className?: string
}) {
  const fieldBase =
    'no-drag peer w-full rounded-2xl border border-white/10 bg-black/70 px-3.5 text-[14px] text-ink ' +
    'outline-none backdrop-blur-md transition-colors placeholder:text-transparent focus:border-iris/55'
  const labelBase =
    'pointer-events-none absolute left-3.5 text-ink-faint transition-all duration-150 ' +
    'peer-focus:text-[10px] peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-iris-soft ' +
    'peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:uppercase peer-[:not(:placeholder-shown)]:tracking-wide'

  return (
    <div className={clsx('relative', className)}>
      {multiline ? (
        <textarea
          autoFocus={autoFocus}
          value={value}
          rows={rows}
          placeholder=" "
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onSubmit && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit()
          }}
          className={clsx(fieldBase, 'resize-none pb-2.5 pt-6 leading-relaxed', mono && 'font-mono text-[13px]')}
        />
      ) : (
        <input
          autoFocus={autoFocus}
          value={value}
          placeholder=" "
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onSubmit && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit()
          }}
          className={clsx(fieldBase, 'pb-2 pt-5', mono && 'font-mono text-[13px]')}
        />
      )}
      <label
        className={clsx(
          labelBase,
          multiline
            ? 'top-3.5 text-sm peer-focus:top-2 peer-[:not(:placeholder-shown)]:top-2'
            : 'top-1/2 -translate-y-1/2 text-sm peer-focus:top-2.5 peer-focus:translate-y-0 peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:translate-y-0'
        )}
      >
        {label}
      </label>
    </div>
  )
}
