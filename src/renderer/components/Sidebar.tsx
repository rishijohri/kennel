import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import {
  Plus,
  Pencil,
  FilePen,
  TerminalSquare,
  BrainCircuit,
  Server,
  Cpu,
  X,
  Sparkles,
  SquareTerminal,
  Trash2,
  PlugZap,
  Footprints,
  Globe,
  Plug,
  Boxes,
  Share2,
  Lock
} from 'lucide-react'
import { useKennel } from '../store/useKennel'
import { IconButton } from './ui'
import { ProcessEditor } from './settings/ProcessEditor'
import { PersonaEditorModal, PersonaCreateModal } from './settings/PersonasPanel'
import { caretakerIcon, walkerIcon } from '../assets/icons'
import { parkCapVisible } from '@shared/park-scope'
import type { AgentPersona, DeterministicProcess, ProviderConfig } from '@shared/types'

const MIN_W = 220
const MAX_W = 460
const DEFAULT_W = 256
const WIDTH_KEY = 'kennel.sidebarWidth'

export function Sidebar() {
  const allPersonas = useKennel((s) => s.state?.personas ?? [])
  const allProcesses = useKennel((s) => s.state?.deterministicProcesses ?? [])
  const providers = useKennel((s) => s.state?.providers ?? [])
  const project = useKennel((s) => s.state?.project ?? null)
  const canvasNodes = useKennel((s) => s.state?.nodes ?? [])
  const parks = useKennel((s) => s.state?.parks ?? [])
  // In a Park, the sidebar shows the SEPARATE pool of Park-scoped capabilities —
  // narrowed to the open Park when this project disables cross-park sharing.
  const openParkId = useKennel((s) => s.openParkId)
  const inPark = Boolean(openParkId)
  const shareParkCaps = project?.shareParkCapabilities !== false
  const setShareParkCapabilities = useKennel((s) => s.setShareParkCapabilities)
  const personas = allPersonas.filter((p) =>
    inPark ? parkCapVisible(p, openParkId ?? undefined, shareParkCaps) : p.scope !== 'park'
  )
  const processes = allProcesses.filter((p) =>
    inPark ? parkCapVisible(p, openParkId ?? undefined, shareParkCaps) : p.scope !== 'park'
  )

  // Usage = how many nodes reference this capability. Canvas items count
  // main-canvas nodes; Park items count workflow nodes across the project's Parks.
  const parkNodes = parks.flatMap((pk) => pk.nodes)
  const personaUsage = (p: AgentPersona) =>
    (p.scope === 'park' ? parkNodes : canvasNodes).filter((n) => n.personaId === p.id).length
  const processUsage = (p: DeterministicProcess) =>
    (p.scope === 'park' ? parkNodes : canvasNodes).filter((n) => n.processId === p.id).length
  const tab = useKennel((s) => s.sidebarTab)
  const setTab = useKennel((s) => s.setSidebarTab)
  const openSettings = useKennel((s) => s.openSettings)
  const openCaretaker = useKennel((s) => s.openCaretaker)
  const openWalker = useKennel((s) => s.openWalker)
  const localStatus = useKennel((s) => s.localStatus)
  const closeProject = useKennel((s) => s.closeProject)
  const deleteProcess = useKennel((s) => s.deleteProcess)

  const [editingProcess, setEditingProcess] = useState<string | 'new' | null>(null)
  const [editingPersona, setEditingPersona] = useState<AgentPersona | null>(null)
  const [creatingPersona, setCreatingPersona] = useState(false)

  const [width, setWidth] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(saved) && saved >= MIN_W && saved <= MAX_W ? saved : DEFAULT_W
  })
  useEffect(() => {
    window.localStorage.setItem(WIDTH_KEY, String(width))
  }, [width])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (ev: MouseEvent) => {
      setWidth(Math.min(MAX_W, Math.max(MIN_W, startW + (ev.clientX - startX))))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-r border-line/70 bg-surface/40"
    >
      {/* Project agents */}
      <div className="space-y-2 p-3">
        <button
          onClick={openWalker}
          className="no-drag group flex w-full items-center gap-2.5 rounded-xl border border-mint/30 bg-gradient-to-br from-mint/12 to-transparent px-3 py-2.5 text-left transition-colors hover:border-mint/60"
        >
          <img src={walkerIcon} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Walker</span>
            <span className="block text-[11px] text-ink-faint">Run a task across the canvas</span>
          </span>
          <Footprints size={14} className="text-mint transition-transform group-hover:scale-110" />
        </button>
        <button
          onClick={openCaretaker}
          className="no-drag group flex w-full items-center gap-2.5 rounded-xl border border-iris/30 bg-gradient-to-br from-iris/12 to-transparent px-3 py-2.5 text-left transition-colors hover:border-iris/60"
        >
          <img src={caretakerIcon} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Care Taker</span>
            <span className="block text-[11px] text-ink-faint">Set up agents & processes</span>
          </span>
          <Sparkles size={14} className="text-iris-soft transition-transform group-hover:scale-110" />
        </button>
      </div>

      {/* Tabs */}
      <div className="mx-3 grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1">
        <TabBtn active={tab === 'personas'} onClick={() => setTab('personas')}>
          <Sparkles size={13} />
          {inPark ? 'Park Personas' : 'Personas'}
        </TabBtn>
        <TabBtn active={tab === 'deterministic'} onClick={() => setTab('deterministic')}>
          <SquareTerminal size={13} />
          {inPark ? 'Park Processes' : 'Processes'}
        </TabBtn>
      </div>

      {inPark && (
        <button
          onClick={() => void setShareParkCapabilities(!shareParkCaps)}
          title={
            shareParkCaps
              ? 'Park personas & processes are shared across all of this project’s Parks. Click to isolate each Park to its own.'
              : 'Each Park only sees the personas & processes it created. Click to share them across this project’s Parks.'
          }
          className="no-drag mx-3 mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface/60 px-2.5 py-1.5 text-left transition-colors hover:border-line-strong"
        >
          {shareParkCaps ? (
            <Share2 size={13} className="shrink-0 text-iris-soft" />
          ) : (
            <Lock size={13} className="shrink-0 text-ink-faint" />
          )}
          <span className="min-w-0 flex-1 text-[11px] text-ink-soft">
            {shareParkCaps ? 'Shared across Parks' : 'Isolated to this Park'}
          </span>
          <span
            className={clsx(
              'relative h-4 w-7 shrink-0 rounded-full transition-colors',
              shareParkCaps ? 'bg-iris/60' : 'bg-surface-overlay'
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 h-3 w-3 rounded-full bg-ink transition-transform',
                shareParkCaps ? 'translate-x-3.5' : 'translate-x-0.5'
              )}
            />
          </span>
        </button>
      )}

      <div className="mt-2 flex items-center justify-between px-4 pb-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {inPark
            ? tab === 'personas'
              ? 'Park personas (I/O contracts)'
              : 'Park processes'
            : tab === 'personas'
              ? 'Agent personas'
              : 'Deterministic processes'}
        </h2>
        <IconButton
          onClick={() =>
            tab === 'personas'
              ? inPark
                ? setCreatingPersona(true)
                : openSettings('personas')
              : setEditingProcess('new')
          }
          aria-label="Add"
          title={inPark ? `Add a Park ${tab === 'personas' ? 'persona' : 'process'}` : 'Add'}
        >
          <Plus size={15} />
        </IconButton>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden px-3 pt-1">
        {tab === 'personas' ? (
          <>
            {personas.length === 0 && (
              <p className="px-1 py-4 text-xs leading-relaxed text-ink-ghost">
                {inPark
                  ? 'No Park personas yet. Ask the Walker to build this workflow — the Care Taker creates tested, contract-bearing personas for it.'
                  : 'No personas yet. Ask the Care Taker to create one, or add it in settings.'}
              </p>
            )}
            {personas.map((p) => (
              <PersonaCard
                key={p.id}
                persona={p}
                provider={providers.find((v) => v.id === p.providerId)}
                usage={personaUsage(p)}
                onEdit={() => setEditingPersona(p)}
              />
            ))}
          </>
        ) : (
          <>
            {processes.length === 0 && (
              <p className="px-1 py-4 text-xs leading-relaxed text-ink-ghost">
                {inPark
                  ? 'No Park processes yet. The Care Taker creates tested processes for this workflow when the Walker builds it.'
                  : 'No processes yet. Ask the Care Taker to create validation or setup scripts, or add one manually.'}
              </p>
            )}
            {processes.map((p) => (
              <ProcessCard
                key={p.id}
                process={p}
                usage={processUsage(p)}
                onEdit={() => setEditingProcess(p.id)}
                onDelete={() => deleteProcess(p.id)}
              />
            ))}
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-line/70 p-3">
        <FooterBtn icon={<Server size={15} />} title="AI Providers" onClick={() => openSettings('providers')}>
          {providers.length ? `${providers.length} configured` : 'Connect Claude, OpenAI, Google…'}
        </FooterBtn>
        <FooterBtn
          icon={<Cpu size={15} />}
          title="Local Models"
          onClick={() => openSettings('local')}
          dot={localStatus?.running ? 'mint' : localStatus?.starting ? 'amber' : undefined}
          pulse={Boolean(localStatus?.starting)}
          accent={Boolean(localStatus?.running)}
        >
          {localStatus?.running
            ? `Running · ${hostLabel(localStatus.baseUrl)}`
            : localStatus?.starting
              ? 'Starting…'
              : 'Run llama.cpp offline'}
        </FooterBtn>
        {project && (
          <button
            onClick={closeProject}
            className="no-drag flex w-full items-center gap-1.5 px-1 text-[11px] text-ink-ghost transition-colors hover:text-rose"
          >
            <X size={12} className="shrink-0" />
            <span className="min-w-0 truncate">Close “{project.name}”</span>
          </button>
        )}
      </div>

      <ProcessEditor
        open={editingProcess !== null}
        processId={editingProcess === 'new' ? null : editingProcess}
        onClose={() => setEditingProcess(null)}
        defaultScope={inPark ? 'park' : undefined}
        ownerParkId={openParkId ?? undefined}
      />

      <PersonaEditorModal persona={editingPersona} onClose={() => setEditingPersona(null)} />
      <PersonaCreateModal
        open={creatingPersona}
        scope="park"
        ownerParkId={openParkId ?? undefined}
        onClose={() => setCreatingPersona(false)}
      />

      {/* Drag handle — sits on the panel's right edge to resize it. */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => setWidth(DEFAULT_W)}
        title="Drag to resize · double-click to reset"
        className="no-drag group absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize"
      >
        <span className="absolute inset-y-0 right-0 w-px bg-transparent transition-colors group-hover:bg-iris/60" />
      </div>
    </aside>
  )
}

function TabBtn({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'no-drag flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all',
        active ? 'bg-surface-overlay text-ink shadow-node' : 'text-ink-faint hover:text-ink-soft'
      )}
    >
      {children}
    </button>
  )
}

/** "127.0.0.1:8080" from a "http://127.0.0.1:8080/v1" base url. */
function hostLabel(u?: string | null): string {
  if (!u) return ''
  return u.replace(/^https?:\/\//, '').replace(/\/v1\/?$/, '')
}

function FooterBtn({
  icon,
  title,
  onClick,
  children,
  dot,
  pulse,
  accent
}: {
  icon: React.ReactNode
  title: string
  onClick: () => void
  children: React.ReactNode
  /** Status dot overlaid on the icon. */
  dot?: 'mint' | 'amber'
  pulse?: boolean
  /** Tint the border + icon (e.g. when a server is running). */
  accent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'no-drag flex w-full items-center gap-2.5 rounded-xl border bg-surface px-3 py-2.5 text-left transition-colors',
        accent ? 'border-mint/40 hover:border-mint/60' : 'border-line hover:border-line-strong'
      )}
    >
      <span className={clsx('relative', accent ? 'text-mint' : 'text-ink-soft')}>
        {icon}
        {dot && (
          <span
            className={clsx(
              'absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-surface',
              dot === 'mint' ? 'bg-mint' : 'bg-amber',
              pulse && 'animate-pulse'
            )}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-ink">{title}</span>
        <span
          className={clsx(
            'block truncate text-[11px]',
            dot === 'mint' ? 'text-mint' : dot === 'amber' ? 'text-amber-soft' : 'text-ink-faint'
          )}
        >
          {children}
        </span>
      </span>
    </button>
  )
}

function PersonaCard({
  persona,
  provider,
  usage,
  onEdit
}: {
  persona: AgentPersona
  provider?: ProviderConfig
  usage: number
  onEdit: () => void
}) {
  const ready = Boolean(provider) && (provider!.hasKey || provider!.kind === 'openai-compatible')
  return (
    <div className="group relative rounded-xl border border-line bg-surface/70 p-3 transition-colors hover:border-line-strong">
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base"
          style={{ background: `${persona.color}1f`, boxShadow: `inset 0 0 0 1px ${persona.color}55` }}
        >
          {persona.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{persona.name}</span>
          {persona.role && <p className="mt-0.5 truncate text-[11px] text-ink-faint">{persona.role}</p>}
          <p className="mt-0.5 truncate text-[10px] text-ink-ghost">
            {provider ? provider.name : 'no provider'} · {persona.model || 'default model'}
          </p>
          <div className="mt-1">
            <UsageBadge usage={usage} scope={persona.scope === 'park' ? 'park' : 'canvas'} />
          </div>
          {persona.ioContract && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
              <span className="text-ink-faint">
                {persona.ioContract.inputs.length} in · {persona.ioContract.outputs.length} out
              </span>
              <span
                className={clsx(
                  'rounded px-1 py-0.5',
                  persona.ioContract.tested ? 'bg-mint/12 text-mint' : 'bg-amber/12 text-amber-soft'
                )}
              >
                {persona.ioContract.tested ? 'tested' : 'untested'}
              </span>
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <Perm on={persona.permissions.canEditFiles} icon={<FilePen size={11} />} label="Edit files" />
            <Perm on={persona.permissions.canRunBash} icon={<TerminalSquare size={11} />} label="Run shell" />
            <Perm on={persona.permissions.canEditCoreMemory} icon={<BrainCircuit size={11} />} label="Core memory" />
            <Perm on={persona.permissions.canSearchWeb} icon={<Globe size={11} />} label="Web search" />
            <Perm on={persona.permissions.canUseMcp} icon={<Plug size={11} />} label="MCP" />
          </div>
        </div>
        <IconButton onClick={onEdit} className="opacity-0 transition-opacity group-hover:opacity-100" aria-label="Edit">
          <Pencil size={13} />
        </IconButton>
      </div>
      {!ready && (
        <div className="mt-2 rounded-lg bg-amber/10 px-2 py-1 text-[10px] text-amber-soft">
          No provider key — configure in settings
        </div>
      )}
    </div>
  )
}

function ProcessCard({
  process,
  usage,
  onEdit,
  onDelete
}: {
  process: DeterministicProcess
  usage: number
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="group relative rounded-xl border border-line bg-surface/70 p-3 transition-colors hover:border-line-strong">
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base"
          style={{ background: `${process.color}1f`, boxShadow: `inset 0 0 0 1px ${process.color}55` }}
        >
          {process.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{process.name}</span>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-ghost">$ {process.command}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-ink-faint">
            {process.inputs.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <PlugZap size={10} />
                {process.inputs.length} input{process.inputs.length === 1 ? '' : 's'}
              </span>
            )}
            <span>
              {process.resultRules.length} rule{process.resultRules.length === 1 ? '' : 's'}
            </span>
            <UsageBadge usage={usage} scope={process.scope === 'park' ? 'park' : 'canvas'} />
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton onClick={onEdit} aria-label="Edit">
            <Pencil size={13} />
          </IconButton>
          <IconButton onClick={onDelete} className="hover:text-rose" aria-label="Delete">
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

/** "N nodes" — how many canvas/workflow nodes currently use this capability. */
function UsageBadge({ usage, scope }: { usage: number; scope?: 'canvas' | 'park' }) {
  const where = scope === 'park' ? "this project's Parks" : 'the canvas'
  return (
    <span
      title={`Used by ${usage} node${usage === 1 ? '' : 's'} in ${where}`}
      className={clsx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
        usage > 0 ? 'bg-iris/12 text-iris-soft' : 'bg-surface text-ink-ghost'
      )}
    >
      <Boxes size={10} />
      {usage} node{usage === 1 ? '' : 's'}
    </span>
  )
}

function Perm({ on, icon, label }: { on: boolean; icon: React.ReactNode; label: string }) {
  return (
    <span
      title={`${label}: ${on ? 'allowed' : 'denied'}`}
      className={
        'flex h-5 w-5 items-center justify-center rounded-md transition-colors ' +
        (on ? 'bg-mint/15 text-mint' : 'bg-surface text-ink-ghost')
      }
    >
      {icon}
    </span>
  )
}
