import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  Cpu,
  FolderOpen,
  Play,
  Square,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Box,
  PackageCheck,
  Settings2,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Sparkles
} from 'lucide-react'
import type {
  LocalAdvancedOptions,
  LocalModel,
  LocalServerConfig,
  LocalServerStatus
} from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { Button, Label, TextInput, Toggle } from '../ui'
import { LlamaReleasePicker } from './LlamaReleasePicker'
import { HfModelBrowser } from './HfModelBrowser'

type OptNum = { on: boolean; value: number }

/** Legacy localStorage key — migrated into main-process storage on first load. */
const LEGACY_MODELS_KEY = 'kennel.localModels'

function baseName(p: string): string {
  return p.split(/[/\\]/).pop() || p
}

export function LocalModelsPanel() {
  const pushToast = useKennel((s) => s.pushToast)
  const engines = useKennel((s) => s.llamaEngines)
  const [showEngine, setShowEngine] = useState(false)
  const [showRecommended, setShowRecommended] = useState(false)
  const [status, setStatus] = useState<LocalServerStatus | null>(null)

  const [models, setModels] = useState<LocalModel[]>([])
  const [modelPath, setModelPath] = useState('')
  const [ctxSize, setCtxSize] = useState(8192)
  const [port, setPort] = useState(8080)
  const [gpuLayers, setGpuLayers] = useState(999)
  const [jinja, setJinja] = useState(true)
  const [alias, setAlias] = useState('')

  // Advanced (opt-in) options.
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [override, setOverride] = useState('')
  const [flashAttn, setFlashAttn] = useState(false)
  const [mlock, setMlock] = useState(false)
  const [noMmap, setNoMmap] = useState(false)
  const [batch, setBatch] = useState<OptNum>({ on: false, value: 2048 })
  const [ubatch, setUbatch] = useState<OptNum>({ on: false, value: 512 })
  const [threads, setThreads] = useState<OptNum>({ on: false, value: 8 })
  const [parallel, setParallel] = useState<OptNum>({ on: false, value: 4 })

  const logRef = useRef<HTMLPreElement>(null)
  // Don't persist config/models until the saved settings have been loaded, or
  // the initial empty-defaults render would overwrite what was saved.
  const hydrated = useRef(false)

  // Apply a saved or live config onto the form fields.
  const applyConfig = (c: LocalServerConfig) => {
    setModelPath(c.modelPath)
    setCtxSize(c.ctxSize)
    setPort(c.port)
    setGpuLayers(c.gpuLayers)
    setJinja(c.jinja)
    setAlias(c.alias ?? '')
    const a = c.advanced ?? {}
    setOverride(a.binaryPath ?? '')
    setFlashAttn(Boolean(a.flashAttention))
    setMlock(Boolean(a.mlock))
    setNoMmap(Boolean(a.noMmap))
    setBatch(a.batchSize ? { on: true, value: a.batchSize } : { on: false, value: 2048 })
    setUbatch(a.ubatchSize ? { on: true, value: a.ubatchSize } : { on: false, value: 512 })
    setThreads(a.threads ? { on: true, value: a.threads } : { on: false, value: 8 })
    setParallel(a.parallel ? { on: true, value: a.parallel } : { on: false, value: 4 })
    if (
      a.binaryPath || a.flashAttention || a.mlock || a.noMmap ||
      a.batchSize || a.ubatchSize || a.threads || a.parallel
    ) {
      setShowAdvanced(true)
    }
  }

  useEffect(() => {
    void (async () => {
      const [d, settings, s] = await Promise.all([
        window.kennel.getLocalDefaults(),
        window.kennel.getLocalSettings(),
        window.kennel.getLocalStatus()
      ])
      setPort((p) => p || d.suggestedPort)

      // Models: prefer the persisted list; migrate the legacy localStorage list
      // once (older builds stored models there) if nothing is saved yet.
      let modelList = settings.models
      if (modelList.length === 0) {
        try {
          const legacy = JSON.parse(window.localStorage.getItem(LEGACY_MODELS_KEY) || '[]')
          if (Array.isArray(legacy) && legacy.length) {
            modelList = legacy
              .filter((m) => m && m.path)
              .map((m) => ({ path: String(m.path), name: m.name || baseName(m.path) }))
            void window.kennel.saveLocalModels(modelList)
            window.localStorage.removeItem(LEGACY_MODELS_KEY)
          }
        } catch {
          /* ignore malformed legacy data */
        }
      }
      setModels(modelList)

      // Restore the saved config, then let a live server's config win (it's the
      // source of truth while running).
      if (settings.config) applyConfig(settings.config)
      setStatus(s)
      if (s.config) {
        applyConfig(s.config)
        setModels((list) =>
          list.some((m) => m.path === s.config!.modelPath)
            ? list
            : [...list, { path: s.config!.modelPath, name: baseName(s.config!.modelPath) }]
        )
      }
      hydrated.current = true
    })()

    const off = window.kennel.onLocalStatus((s) => setStatus(s))
    return off
  }, [])

  // Persist the model list whenever it changes (after the initial hydration).
  useEffect(() => {
    if (hydrated.current) void window.kennel.saveLocalModels(models)
  }, [models])

  // Persist the server configuration as the user edits it, lightly debounced, so
  // the exact settings are restored next session without re-entering them.
  useEffect(() => {
    if (!hydrated.current) return
    const t = setTimeout(() => void window.kennel.saveLocalConfig(currentConfig()), 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelPath, ctxSize, port, gpuLayers, jinja, alias, override, flashAttn, mlock, noMmap, batch, ubatch, threads, parallel])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [status?.log])

  const starting = status?.starting ?? false
  const running = status?.running ?? false

  const buildAdvanced = (): LocalAdvancedOptions | undefined => {
    const adv: LocalAdvancedOptions = {}
    if (override.trim()) adv.binaryPath = override.trim()
    if (flashAttn) adv.flashAttention = true
    if (mlock) adv.mlock = true
    if (noMmap) adv.noMmap = true
    if (batch.on && batch.value > 0) adv.batchSize = batch.value
    if (ubatch.on && ubatch.value > 0) adv.ubatchSize = ubatch.value
    if (threads.on && threads.value > 0) adv.threads = threads.value
    if (parallel.on && parallel.value > 0) adv.parallel = parallel.value
    return Object.keys(adv).length ? adv : undefined
  }

  /** Assemble the current form into a server config (used to start & to persist). */
  const currentConfig = (): LocalServerConfig => ({
    modelPath,
    ctxSize,
    port,
    gpuLayers,
    jinja,
    alias: alias.trim() || undefined,
    advanced: buildAdvanced()
  })

  const start = async () => {
    if (!modelPath) {
      pushToast('error', 'Choose a model file first.')
      return
    }
    if (!engines?.activeTag && !override.trim()) {
      pushToast(
        'error',
        'No llama.cpp engine installed — download one under "Manage" above (or set an override in Advanced options).'
      )
      return
    }
    try {
      await window.kennel.startLocalServer(currentConfig())
      pushToast('success', 'Local model server is ready.')
    } catch {
      pushToast('error', 'Local server failed to start — see the log below.')
    }
  }

  const stop = async () => {
    await window.kennel.stopLocalServer()
  }

  const addModel = async () => {
    const p = await window.kennel.pickModelFile()
    if (!p) return
    // The models effect persists the new list (and the config effect the path).
    setModels((list) =>
      list.some((m) => m.path === p) ? list : [...list, { path: p, name: baseName(p) }]
    )
    setModelPath(p)
  }
  const removeModel = (path: string) => {
    setModels((list) => list.filter((m) => m.path !== path))
    if (modelPath === path) setModelPath('')
  }
  const pickBinary = async () => {
    const p = await window.kennel.pickBinaryFile()
    if (p) setOverride(p)
  }
  /** A model downloaded from HuggingFace lands in the list just like a browsed file. */
  const addDownloadedModel = (path: string, name: string) => {
    setModels((list) => (list.some((m) => m.path === path) ? list : [...list, { path, name }]))
    setModelPath(path)
  }

  return (
    <div className="space-y-5 p-5">
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface/50 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-iris/12 text-iris-soft">
          <Cpu size={17} />
        </div>
        <div className="text-sm text-ink-soft">
          Run a model fully offline with <span className="text-ink">llama.cpp</span>, downloaded for
          your platform and upgradable anytime. Kennel launches it with{' '}
          <code className="text-iris-soft">--jinja</code> (chat template + tool calls) and registers
          a <span className="text-ink">Local (llama.cpp)</span> provider you can assign to any
          persona.
        </div>
      </div>

      {/* Status banner */}
      <StatusBanner status={status} />

      {/* Engine (downloaded llama.cpp build) */}
      <div className="overflow-hidden rounded-2xl border border-line">
        <button
          onClick={() => setShowEngine((v) => !v)}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] hover:bg-surface"
        >
          <PackageCheck
            size={15}
            className={engines?.activeTag || override.trim() ? 'text-mint' : 'text-amber'}
          />
          <span className="min-w-0 flex-1 truncate">
            {override.trim() ? (
              <span className="text-ink-soft">
                Custom binary: <span className="font-mono text-[12px] text-ink">{override}</span>
              </span>
            ) : engines?.activeTag ? (
              <span className="text-ink-soft">
                Engine <span className="font-mono text-ink">{engines.activeTag}</span>
                <span className="text-ink-faint"> · {engines.platform}</span>
              </span>
            ) : (
              <span className="text-amber-soft">No engine installed — download one to run models.</span>
            )}
          </span>
          <span className="text-[11px] text-ink-faint">{showEngine ? 'Hide' : 'Manage'}</span>
          {showEngine ? (
            <ChevronDown size={15} className="text-ink-ghost" />
          ) : (
            <ChevronRight size={15} className="text-ink-ghost" />
          )}
        </button>
        {showEngine && (
          <div className="border-t border-line p-3.5">
            <LlamaReleasePicker />
          </div>
        )}
      </div>

      {/* Model */}
      <div>
        <Label>Model (.gguf)</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {models.map((m) => {
            const selected = modelPath === m.path
            return (
              <span
                key={m.path}
                className={clsx(
                  'group inline-flex max-w-full items-center gap-1.5 rounded-lg border py-1.5 pl-2.5 pr-1.5 text-xs transition-colors',
                  selected
                    ? 'border-iris bg-iris/10 text-ink'
                    : 'border-line text-ink-soft hover:border-line-strong'
                )}
              >
                <button
                  type="button"
                  onClick={() => setModelPath(m.path)}
                  title={m.path}
                  className="no-drag flex min-w-0 items-center gap-1.5"
                >
                  <Box size={12} className="shrink-0" />
                  <span className="truncate">{m.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeModel(m.path)}
                  title="Remove model"
                  className="no-drag shrink-0 rounded p-0.5 text-ink-ghost transition-colors hover:text-rose"
                >
                  <X size={12} />
                </button>
              </span>
            )
          })}
          <Button variant="subtle" onClick={addModel} className="shrink-0">
            <Plus size={14} />
            Add model
          </Button>
        </div>
        {models.length === 0 && (
          <p className="mt-1.5 text-[11px] text-ink-ghost">
            No models yet — click <span className="text-ink-faint">Add model</span> to browse for a
            .gguf file, or pick a recommended one below.
          </p>
        )}

        {/* Recommended models from HuggingFace (unsloth) — recommendations only. */}
        <div className="mt-2 overflow-hidden rounded-xl border border-line">
          <button
            onClick={() => setShowRecommended((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-surface"
          >
            <Sparkles size={14} className="text-iris-soft" />
            <span className="flex-1 text-ink-soft">
              Recommended models <span className="text-ink-faint">· unsloth on HuggingFace</span>
            </span>
            {showRecommended ? (
              <ChevronDown size={14} className="text-ink-ghost" />
            ) : (
              <ChevronRight size={14} className="text-ink-ghost" />
            )}
          </button>
          {showRecommended && (
            <div className="border-t border-line p-3">
              <HfModelBrowser onAdded={addDownloadedModel} />
            </div>
          )}
        </div>
      </div>

      {/* Params */}
      <div className="grid grid-cols-3 gap-3">
        <NumberField label="Context window" value={ctxSize} onChange={setCtxSize} step={1024} />
        <NumberField label="GPU layers (-ngl)" value={gpuLayers} onChange={setGpuLayers} />
        <NumberField label="Port" value={port} onChange={setPort} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Served name (alias)</Label>
          <TextInput
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="optional"
            className="font-mono text-[12px]"
          />
        </div>
        <div className="flex items-end">
          <Toggle
            label="Enable jinja"
            hint="Chat template & tool calling"
            checked={jinja}
            onChange={setJinja}
          />
        </div>
      </div>

      {/* Advanced options */}
      <div className="overflow-hidden rounded-2xl border border-line">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="no-drag flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface/50"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <Settings2 size={15} className="text-ink-soft" />
            Advanced options
          </span>
          {showAdvanced ? (
            <ChevronDown size={16} className="text-ink-faint" />
          ) : (
            <ChevronRight size={16} className="text-ink-faint" />
          )}
        </button>

        {showAdvanced && (
          <div className="space-y-4 border-t border-line p-4">
            {/* Binary override */}
            <div>
              <Label>Override server binary</Label>
              <div className="flex gap-2">
                <TextInput
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                  placeholder="leave empty to use the downloaded engine"
                  className="font-mono text-[12px]"
                />
                <Button variant="subtle" onClick={pickBinary} className="shrink-0">
                  <FolderOpen size={14} />
                  Browse
                </Button>
                {override && (
                  <Button variant="subtle" onClick={() => setOverride('')} className="shrink-0">
                    Clear
                  </Button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-ink-ghost">
                Use a llama-server you built yourself — its sibling dylibs must be alongside it.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Server tuning — only sent when enabled
              </p>
            </div>

            <Toggle
              label="Flash attention"
              hint="--flash-attn on"
              checked={flashAttn}
              onChange={setFlashAttn}
            />
            <div className="grid grid-cols-2 gap-3">
              <Toggle label="mlock" hint="Keep model in RAM" checked={mlock} onChange={setMlock} />
              <Toggle
                label="No mmap"
                hint="Disable memory-mapping"
                checked={noMmap}
                onChange={setNoMmap}
              />
            </div>

            <AdvNumberRow
              label="Batch size"
              flag="-b"
              hint="Logical max batch"
              opt={batch}
              onChange={setBatch}
              step={128}
            />
            <AdvNumberRow
              label="U-batch size"
              flag="-ub"
              hint="Physical max batch"
              opt={ubatch}
              onChange={setUbatch}
              step={128}
            />
            <AdvNumberRow
              label="CPU threads"
              flag="-t"
              hint="Generation threads"
              opt={threads}
              onChange={setThreads}
            />
            <AdvNumberRow
              label="Parallel slots"
              flag="-np"
              hint="Concurrent requests"
              opt={parallel}
              onChange={setParallel}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {running ? (
          <Button variant="danger" onClick={stop}>
            <Square size={14} />
            Stop server
          </Button>
        ) : (
          <Button variant="primary" onClick={start} disabled={starting}>
            {starting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {starting ? 'Starting…' : 'Start server'}
          </Button>
        )}
        {running && (
          <span className="text-xs text-ink-faint">
            Personas can now use the <span className="text-ink">Local (llama.cpp)</span> provider.
          </span>
        )}
      </div>

      {/* Log */}
      {(status?.log || starting) && (
        <div>
          <Label>Server log</Label>
          <pre
            ref={logRef}
            className="selectable max-h-48 overflow-auto rounded-xl border border-line bg-base/60 p-3 font-mono text-[11px] leading-relaxed text-ink-faint"
          >
            {status?.log || 'Waiting for output…'}
          </pre>
        </div>
      )}
    </div>
  )
}

function StatusBanner({ status }: { status: LocalServerStatus | null }) {
  if (!status) return null
  if (status.running) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-mint/30 bg-mint/10 px-3.5 py-2.5 text-sm text-mint">
        <CheckCircle2 size={16} />
        Running at <span className="font-mono">{status.baseUrl}</span>
      </div>
    )
  }
  if (status.starting) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-iris/30 bg-iris/10 px-3.5 py-2.5 text-sm text-iris-soft">
        <Loader2 size={16} className="animate-spin" />
        Loading the model…
      </div>
    )
  }
  if (status.error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-rose/30 bg-rose/10 px-3.5 py-2.5 text-sm text-rose-soft">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span className="selectable">{status.error}</span>
      </div>
    )
  }
  return null
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={clsx(
        'no-drag relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? '' : 'bg-line-strong'
      )}
      style={checked ? { background: '#7c6cff' } : undefined}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
          checked ? 'left-[22px]' : 'left-0.5'
        )}
      />
    </button>
  )
}

function AdvNumberRow({
  label,
  flag,
  hint,
  opt,
  onChange,
  step = 1
}: {
  label: string
  flag: string
  hint?: string
  opt: OptNum
  onChange: (o: OptNum) => void
  step?: number
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <Switch checked={opt.on} onChange={(on) => onChange({ ...opt, on })} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{label}</span>
          <code className="shrink-0 text-[11px] text-iris-soft">{flag}</code>
        </div>
        {hint && <p className="truncate text-[11px] text-ink-faint">{hint}</p>}
      </div>
      {/* Fixed-width box so the input (w-full) can't expand and squeeze the label. */}
      <div className="w-24 shrink-0">
        <TextInput
          type="number"
          step={step}
          value={opt.value}
          disabled={!opt.on}
          onChange={(e) => onChange({ ...opt, value: Number(e.target.value) || 0 })}
          className={clsx('font-mono text-[13px]', !opt.on && 'opacity-40')}
        />
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  step = 1
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step?: number
}) {
  return (
    <div>
      <Label>{label}</Label>
      <TextInput
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="font-mono text-[13px]"
      />
    </div>
  )
}
