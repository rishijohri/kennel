import { Download, RefreshCw, CloudDownload, AlertTriangle } from 'lucide-react'
import { useKennel } from '../store/useKennel'
import { Button, Modal, ModalHeader, Spinner } from './ui'

/** Strip any stray HTML/markdown noise so release notes render as safe plain text. */
function plainNotes(notes?: string): string {
  if (!notes) return ''
  return notes
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, 800)
}

/**
 * Startup popup for a GitHub release update. Auto-opens once when a new version
 * first appears (see foldUpdate in the store); afterwards it's reachable from the
 * title-bar Update pill. "Update now" downloads + relaunches; "Update in
 * background" downloads silently and surfaces the title-bar pill when ready.
 */
export function UpdateModal() {
  const open = useKennel((s) => s.updateModalOpen)
  const update = useKennel((s) => s.updateState)
  const close = useKennel((s) => s.closeUpdateModal)
  const startUpdate = useKennel((s) => s.startUpdate)
  const applyUpdate = useKennel((s) => s.applyUpdate)
  const checkForUpdates = useKennel((s) => s.checkForUpdates)

  const { phase, info, percent, error, restartWhenReady } = update
  const version = info?.version
  const notes = plainNotes(info?.releaseNotes)

  return (
    <Modal open={open} onClose={close} className="max-w-md" labelledBy="upd-title">
      <ModalHeader
        id="upd-title"
        title={phase === 'downloaded' ? 'Update ready' : phase === 'error' ? 'Update problem' : 'Update available'}
        subtitle={
          version
            ? `Kennel ${version}${phase === 'downloaded' ? ' is ready to install' : ''}`
            : 'A new version of Kennel is available'
        }
        onClose={close}
      />

      <div className="space-y-4 px-6 py-5">
        {phase === 'available' && (
          <>
            <p className="text-sm leading-relaxed text-ink-soft">
              A newer version is available on GitHub. Download and install it now, or let it download
              in the background and install when you’re ready.
            </p>
            {notes && (
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-surface/60 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-faint">
                {notes}
              </div>
            )}
          </>
        )}

        {phase === 'downloading' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-[12px] text-ink-soft">
              <span className="flex items-center gap-1.5">
                <CloudDownload size={14} className="text-iris-soft" />
                Downloading update…
              </span>
              <span className="font-mono text-ink">{percent ?? 0}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-overlay">
              <div
                className="h-full rounded-full bg-iris transition-[width] duration-200"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <p className="text-[11px] text-ink-ghost">
              {restartWhenReady
                ? 'Kennel will restart automatically once the download finishes.'
                : 'You can keep working — you’ll get an Update button when it’s ready.'}
            </p>
          </div>
        )}

        {phase === 'downloaded' && (
          <p className="text-sm leading-relaxed text-ink-soft">
            {restartWhenReady ? (
              <span className="flex items-center gap-2">
                <Spinner size={14} /> Restarting to finish the update…
              </span>
            ) : (
              'The update has been downloaded. Restart Kennel to finish installing it.'
            )}
          </p>
        )}

        {phase === 'error' && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose/30 bg-rose/10 px-3.5 py-3 text-[12.5px] leading-relaxed text-rose-soft">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose" />
            <span>{error || 'The update could not be completed. Please try again later.'}</span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
        {phase === 'available' && (
          <>
            <Button variant="ghost" onClick={close}>
              Later
            </Button>
            <Button variant="subtle" onClick={() => void startUpdate(false)}>
              <CloudDownload size={15} />
              Update in background
            </Button>
            <Button variant="primary" onClick={() => void startUpdate(true)}>
              <Download size={15} />
              Update now
            </Button>
          </>
        )}

        {phase === 'downloading' && (
          <Button variant="subtle" onClick={close}>
            Hide
          </Button>
        )}

        {phase === 'downloaded' && !restartWhenReady && (
          <>
            <Button variant="ghost" onClick={close}>
              Later
            </Button>
            <Button variant="primary" onClick={() => void applyUpdate()}>
              <RefreshCw size={15} />
              Restart &amp; install
            </Button>
          </>
        )}

        {phase === 'downloaded' && restartWhenReady && (
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        )}

        {phase === 'error' && (
          <>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void checkForUpdates()}>
              <RefreshCw size={15} />
              Check again
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
