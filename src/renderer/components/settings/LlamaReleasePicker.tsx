import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Download, Check, Trash2, RefreshCw, ExternalLink, Cpu } from 'lucide-react'
import type { LlamaRelease } from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { Button, Spinner } from '../ui'

function fmtBytes(n: number): string {
  if (!n) return ''
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB'
  return (n / 1e6).toFixed(0) + ' MB'
}
function fmtDate(iso: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return iso
  }
}

export function LlamaReleasePicker({ onInstalled }: { onInstalled?: () => void }) {
  const engines = useKennel((s) => s.llamaEngines)
  const downloads = useKennel((s) => s.downloads)
  const loadEngines = useKennel((s) => s.loadLlamaEngines)
  const downloadLlama = useKennel((s) => s.downloadLlama)
  const setActive = useKennel((s) => s.setActiveLlama)
  const removeLlama = useKennel((s) => s.removeLlama)

  const [releases, setReleases] = useState<LlamaRelease[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const platform = engines?.platform ?? '…'
  const installedTags = new Set((engines?.installs ?? []).map((i) => i.tag))
  const activeTag = engines?.activeTag ?? null
  const active = downloads ? Object.values(downloads).find((d) => d.kind === 'llama') : undefined

  const loadReleases = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await window.kennel.listLlamaReleases()
      setReleases(r)
      setSelected((cur) => cur ?? r[0]?.tag ?? null) // latest first, auto-select newest
    } catch (e: any) {
      setError(e?.message ?? 'Could not fetch releases from GitHub.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadEngines()
    void loadReleases()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sel = releases?.find((r) => r.tag === selected) ?? null
  const downloadingTag = active?.id ?? null

  const doDownload = async (tag: string) => {
    await downloadLlama(tag)
    onInstalled?.()
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* Installed engines */}
      {engines && engines.installs.length > 0 && (
        <div className="rounded-xl border border-line bg-surface/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            <Cpu size={12} /> Installed engines
          </div>
          <div className="space-y-1">
            {engines.installs.map((i) => (
              <div key={i.tag} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface">
                <span className="font-mono text-[13px] text-ink">{i.tag}</span>
                <span className="text-[11px] text-ink-faint">{i.platform}</span>
                {i.tag === activeTag ? (
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-mint/12 px-2 py-0.5 text-[11px] text-mint">
                    <Check size={11} /> Active
                  </span>
                ) : (
                  <button
                    onClick={() => void setActive(i.tag)}
                    className="ml-auto rounded-md px-2 py-0.5 text-[11px] text-ink-soft hover:bg-surface-hover hover:text-ink"
                  >
                    Use
                  </button>
                )}
                <button
                  onClick={() => void removeLlama(i.tag)}
                  title="Delete this build"
                  className="rounded-md p-1 text-ink-ghost hover:text-rose"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          llama.cpp releases · <span className="text-ink-soft">{platform}</span>
        </div>
        <button
          onClick={() => void loadReleases()}
          disabled={loading}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-soft hover:bg-surface-hover hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose/30 bg-rose/10 p-2.5 text-xs text-rose-soft">{error}</div>
      )}

      {!releases && loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-ink-faint">
          <Spinner size={16} /> Fetching releases…
        </div>
      )}

      {releases && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,200px)_1fr] gap-3">
          {/* Release list (latest first) */}
          <div className="max-h-[340px] space-y-0.5 overflow-y-auto pr-1">
            {releases.map((r) => {
              const installed = installedTags.has(r.tag)
              return (
                <button
                  key={r.tag}
                  onClick={() => setSelected(r.tag)}
                  className={clsx(
                    'block w-full rounded-lg px-2.5 py-1.5 text-left transition-colors',
                    selected === r.tag ? 'bg-surface-overlay' : 'hover:bg-surface'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[13px] text-ink">{r.tag}</span>
                    {installed && <Check size={12} className="text-mint" />}
                    {r.prerelease && (
                      <span className="rounded bg-amber/15 px-1 text-[9px] uppercase text-amber-soft">pre</span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-ink-faint">{fmtDate(r.publishedAt)}</div>
                </button>
              )
            })}
          </div>

          {/* Selected release detail */}
          <div className="flex min-h-0 flex-col rounded-xl border border-line bg-surface/60 p-3">
            {sel ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm text-ink">{sel.tag}</div>
                    <div className="text-[11px] text-ink-faint">{fmtDate(sel.publishedAt)}</div>
                  </div>
                  <a
                    href={sel.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-iris-soft hover:underline"
                  >
                    GitHub <ExternalLink size={11} />
                  </a>
                </div>

                <div className="my-2.5 max-h-[180px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface/80 p-2.5 text-[12px] leading-relaxed text-ink-soft">
                  {sel.notes || 'No release notes provided.'}
                </div>

                {downloadingTag === sel.tag && active ? (
                  <div className="mt-auto">
                    <div className="mb-1 flex justify-between text-[11px] text-ink-faint">
                      <span className="capitalize">{active.phase}…</span>
                      <span>
                        {active.totalBytes
                          ? `${fmtBytes(active.receivedBytes)} / ${fmtBytes(active.totalBytes)}`
                          : fmtBytes(active.receivedBytes)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-overlay">
                      <div
                        className="h-full rounded-full bg-mint transition-all"
                        style={{
                          width: active.totalBytes
                            ? `${Math.round((active.receivedBytes / active.totalBytes) * 100)}%`
                            : '40%'
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <span className="text-[11px] text-ink-faint">
                      {sel.asset ? `${sel.asset.name} · ${fmtBytes(sel.asset.size)}` : `No build for ${platform}`}
                    </span>
                    <Button
                      variant={installedTags.has(sel.tag) ? 'ghost' : 'primary'}
                      className="px-3 py-1.5 text-xs"
                      disabled={!sel.asset || Boolean(downloadingTag)}
                      onClick={() => void doDownload(sel.tag)}
                    >
                      <Download size={13} />
                      {installedTags.has(sel.tag) ? 'Re-download' : 'Download'}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-ink-faint">
                Select a release to see what's new.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
