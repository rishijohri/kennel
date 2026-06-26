import { clsx } from 'clsx'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useKennel } from '../store/useKennel'

export function Toasts() {
  const toasts = useKennel((s) => s.toasts)
  const dismiss = useKennel((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-panel animate-scale-in glass',
            t.kind === 'error'
              ? 'border-rose/40 text-rose-soft'
              : t.kind === 'success'
                ? 'border-mint/40 text-mint'
                : 'border-line text-ink-soft'
          )}
        >
          <span className="mt-0.5 shrink-0">
            {t.kind === 'error' ? (
              <AlertCircle size={15} />
            ) : t.kind === 'success' ? (
              <CheckCircle2 size={15} />
            ) : (
              <Info size={15} />
            )}
          </span>
          <span className="selectable flex-1 text-[13px] leading-relaxed">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="no-drag shrink-0 text-ink-faint transition-colors hover:text-ink"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
