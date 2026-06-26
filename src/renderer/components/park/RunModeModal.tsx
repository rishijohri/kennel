import { clsx } from 'clsx'
import { FlaskConical, Save } from 'lucide-react'
import type { WorkflowRunMode } from '@shared/types'
import { Modal } from '../ui'

/**
 * Asked before every manual Park run: is this a throwaway (temporary) run, or a
 * recorded run kept in the Park's history with its workspace and report?
 */
export function RunModeModal({
  open,
  onClose,
  onPick
}: {
  open: boolean
  onClose: () => void
  onPick: (mode: WorkflowRunMode) => void
}) {
  return (
    <Modal open={open} onClose={onClose} className="max-w-lg" labelledBy="runmode-title">
      <div className="border-b border-line px-6 py-4">
        <h2 id="runmode-title" className="text-base font-semibold text-ink">
          Run this workflow
        </h2>
        <p className="mt-0.5 text-xs text-ink-faint">
          Choose how this run is kept. Either way it runs in an isolated workspace against the
          frozen codebase.
        </p>
      </div>
      <div className="grid gap-3 px-6 py-5 sm:grid-cols-2">
        <RunModeCard
          icon={<FlaskConical size={18} />}
          title="Temporary"
          accent="#ffb454"
          desc="Throwaway run for testing. Its workspace is discarded when it finishes; nothing enters history."
          onClick={() => onPick('temporary')}
        />
        <RunModeCard
          icon={<Save size={18} />}
          title="Recorded"
          accent="#56b6ff"
          desc="Saved to this Park's run history with its workspace files and report, so you can review it later."
          onClick={() => onPick('recorded')}
        />
      </div>
    </Modal>
  )
}

function RunModeCard({
  icon,
  title,
  desc,
  accent,
  onClick
}: {
  icon: React.ReactNode
  title: string
  desc: string
  accent: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'no-drag flex flex-col gap-2 rounded-xl border border-line p-4 text-left transition-all hover:border-line-strong hover:bg-surface-hover'
      )}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ background: `${accent}22`, boxShadow: `inset 0 0 0 1px ${accent}55`, color: accent }}
      >
        {icon}
      </span>
      <span className="text-sm font-semibold text-ink">{title}</span>
      <span className="text-[11px] leading-relaxed text-ink-faint">{desc}</span>
    </button>
  )
}
