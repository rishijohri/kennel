import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Download, Search, ChevronRight, ChevronDown, ExternalLink, Heart, ArrowDownToLine } from 'lucide-react'
import type { HfModel, HfModelFile } from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { Spinner } from '../ui'

function fmtBytes(n: number | null): string {
  if (!n) return ''
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB'
  return (n / 1e6).toFixed(0) + ' MB'
}
function fmtCount(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k'
  return String(n)
}

/** Recommended unsloth GGUF models. The user can still add ANY local file via
 *  the existing browse option — these are recommendations only. */
export function HfModelBrowser({ onAdded }: { onAdded: (path: string, name: string) => void }) {
  const downloads = useKennel((s) => s.downloads)
  const pushToast = useKennel((s) => s.pushToast)

  const [models, setModels] = useState<HfModel[] | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, HfModelFile[] | 'loading'>>({})

  const search = async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      setModels(await window.kennel.listHfModels(q))
    } catch (e: any) {
      setError(e?.message ?? 'Could not reach HuggingFace.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void search('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = async (repo: string) => {
    if (expanded === repo) {
      setExpanded(null)
      return
    }
    setExpanded(repo)
    if (!files[repo]) {
      setFiles((f) => ({ ...f, [repo]: 'loading' }))
      try {
        const list = await window.kennel.listHfModelFiles(repo)
        setFiles((f) => ({ ...f, [repo]: list }))
      } catch (e: any) {
        setFiles((f) => ({ ...f, [repo]: [] }))
        pushToast('error', e?.message ?? 'Could not list files.')
      }
    }
  }

  const download = async (file: HfModelFile) => {
    try {
      const path = await window.kennel.downloadHfModel(file)
      onAdded(path, file.filename.split('/').pop() || file.filename)
      pushToast('success', `Added ${file.filename.split('/').pop()}.`)
    } catch (e: any) {
      pushToast('error', e?.message ?? 'Download failed')
    }
  }

  return (
    <div className="space-y-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void search(query)
        }}
        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5"
      >
        <Search size={14} className="text-ink-ghost" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search unsloth models (e.g. qwen, llama, gemma)…"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-ghost"
        />
        {loading && <Spinner size={13} />}
      </form>

      {error && (
        <div className="rounded-lg border border-rose/30 bg-rose/10 p-2.5 text-xs text-rose-soft">{error}</div>
      )}

      <div className="max-h-[300px] space-y-1 overflow-y-auto">
        {models?.map((m) => {
          const isOpen = expanded === m.repo
          const repoFiles = files[m.repo]
          return (
            <div key={m.repo} className="rounded-lg border border-line/70 bg-surface/50">
              <button
                onClick={() => void toggle(m.repo)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
              >
                {isOpen ? <ChevronDown size={14} className="text-ink-ghost" /> : <ChevronRight size={14} className="text-ink-ghost" />}
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.name}</span>
                <span className="flex items-center gap-1 text-[10.5px] text-ink-faint">
                  <ArrowDownToLine size={10} /> {fmtCount(m.downloads)}
                </span>
                <span className="flex items-center gap-1 text-[10.5px] text-ink-faint">
                  <Heart size={10} /> {fmtCount(m.likes)}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-line/60 px-2.5 py-1.5">
                  <a
                    href={`https://huggingface.co/${m.repo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-1.5 flex items-center gap-1 text-[11px] text-iris-soft hover:underline"
                  >
                    {m.repo} <ExternalLink size={10} />
                  </a>
                  {repoFiles === 'loading' || !repoFiles ? (
                    <div className="flex items-center gap-2 py-2 text-[12px] text-ink-faint">
                      <Spinner size={12} /> Loading files…
                    </div>
                  ) : repoFiles.length === 0 ? (
                    <div className="py-2 text-[12px] text-ink-faint">No GGUF files found.</div>
                  ) : (
                    <div className="space-y-0.5">
                      {repoFiles.map((f) => {
                        const dl = downloads[`${f.repo}/${f.filename}`]
                        return (
                          <div key={f.filename} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface">
                            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-soft">
                              {f.filename.split('/').pop()}
                            </span>
                            <span className="text-[10.5px] text-ink-faint">{fmtBytes(f.size)}</span>
                            {dl ? (
                              <span className="w-24 text-right text-[10.5px] text-mint">
                                {dl.totalBytes
                                  ? `${Math.round((dl.receivedBytes / dl.totalBytes) * 100)}%`
                                  : fmtBytes(dl.receivedBytes)}
                              </span>
                            ) : (
                              <button
                                onClick={() => void download(f)}
                                title="Download into your models"
                                className="rounded-md p-1 text-ink-soft hover:bg-surface-hover hover:text-mint"
                              >
                                <Download size={13} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {models && models.length === 0 && !loading && (
          <div className="py-6 text-center text-xs text-ink-faint">No models matched.</div>
        )}
      </div>
    </div>
  )
}
