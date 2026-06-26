import { Cpu } from 'lucide-react'
import { useKennel } from '../../store/useKennel'
import { Button, Modal } from '../ui'
import { LlamaReleasePicker } from './LlamaReleasePicker'

/**
 * First-run, SKIPPABLE prompt to set up the local LLM by downloading a llama.cpp
 * engine release. Cloud-only users can skip; it's re-openable from Local Models.
 */
export function LocalSetupModal() {
  const open = useKennel((s) => s.localSetupOpen)
  const close = useKennel((s) => s.closeLocalSetup)
  const engines = useKennel((s) => s.llamaEngines)
  const hasEngine = (engines?.installs.length ?? 0) > 0

  return (
    <Modal open={open} onClose={() => close(true)} className="flex max-h-[86vh] max-w-3xl flex-col" labelledBy="ls-title">
      <div className="flex items-start gap-3 border-b border-line px-6 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-iris/12 text-iris-soft">
          <Cpu size={20} />
        </div>
        <div className="min-w-0">
          <h2 id="ls-title" className="text-base font-semibold text-ink">
            Set up the local AI engine
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">
            Kennel runs local models with llama.cpp. Pick a release to download for your platform —
            the newest is first, with what's changed in each. You can upgrade anytime for newer-model
            support. Prefer cloud models? You can skip this and set it up later.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <LlamaReleasePicker />
      </div>

      <div className="flex items-center justify-between border-t border-line px-6 py-3">
        <span className="text-xs text-ink-faint">
          {hasEngine ? 'Engine installed — you’re ready to run local models.' : 'No engine installed yet.'}
        </span>
        <Button variant={hasEngine ? 'primary' : 'ghost'} className="px-4 py-1.5 text-sm" onClick={() => close(true)}>
          {hasEngine ? 'Done' : 'Skip for now'}
        </Button>
      </div>
    </Modal>
  )
}
