import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Plus,
  Trash2,
  Pencil,
  Plug,
  CheckCircle2,
  XCircle,
  KeyRound,
  Loader2,
  Users,
  AlertTriangle,
  ArrowRightLeft
} from 'lucide-react'
import type { AgentPersona, ProviderConfig, ProviderKind } from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { Button, Label, Select, TextInput, Modal, ModalHeader } from '../ui'

/** Personas + agents that depend on a provider (optionally narrowed to a model). */
interface ProviderUsage {
  /** Every persona in the GLOBAL library on this provider. */
  library: AgentPersona[]
  /** The subset that are in the OPEN project. */
  project: AgentPersona[]
  /** Non-persona dependents (Care Taker / Walker) on this provider. */
  agents: string[]
  /** model → personas on that exact model (global library). */
  byModel: Map<string, AgentPersona[]>
}

const KIND_LABEL: Record<ProviderKind, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI-compatible (local / hosted)',
  google: 'Google AI Studio (Gemini)',
  'google-vertex': 'Google Vertex AI'
}

export function ProvidersPanel() {
  const providers = useKennel((s) => s.state?.providers ?? [])
  const personaLibrary = useKennel((s) => s.state?.personaLibrary ?? [])
  const projectPersonas = useKennel((s) => s.state?.personas ?? [])
  const caretaker = useKennel((s) => s.state?.caretaker)
  const walker = useKennel((s) => s.state?.walker)
  const deleteProvider = useKennel((s) => s.deleteProvider)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ProviderConfig | null>(null)
  const [tests, setTests] = useState<
    Record<string, { state: 'loading' | 'ok' | 'fail'; message: string }>
  >({})

  // How many personas / agents depend on each provider (and on each model).
  const usageByProvider = useMemo(() => {
    const projectIds = new Set(projectPersonas.map((p) => p.id))
    const map = new Map<string, ProviderUsage>()
    for (const prov of providers) {
      const library = personaLibrary.filter((p) => p.providerId === prov.id)
      const byModel = new Map<string, AgentPersona[]>()
      for (const p of library) {
        const arr = byModel.get(p.model) ?? []
        arr.push(p)
        byModel.set(p.model, arr)
      }
      const agents: string[] = []
      if (caretaker?.providerId === prov.id) agents.push('Care Taker')
      if (walker?.providerId === prov.id) agents.push('Walker')
      map.set(prov.id, {
        library,
        project: library.filter((p) => projectIds.has(p.id)),
        agents,
        byModel
      })
    }
    return map
  }, [providers, personaLibrary, projectPersonas, caretaker, walker])

  const requestDelete = (p: ProviderConfig) => {
    const u = usageByProvider.get(p.id)
    if (u && (u.library.length > 0 || u.agents.length > 0)) setConfirmDelete(p)
    else void deleteProvider(p.id)
  }

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { state: 'loading', message: '' } }))
    const res = await window.kennel.testProvider(id)
    setTests((t) => ({
      ...t,
      [id]: { state: res.ok ? 'ok' : 'fail', message: res.message }
    }))
  }

  if (editing) {
    const initial = editing === 'new' ? undefined : providers.find((p) => p.id === editing)
    return <ProviderForm initial={initial} onDone={() => setEditing(null)} />
  }

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-soft">
          Keys are encrypted on disk and never leave your machine.
        </p>
        <Button variant="primary" onClick={() => setEditing('new')} className="text-xs">
          <Plus size={15} />
          Add provider
        </Button>
      </div>

      {providers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <Plug size={22} className="mx-auto mb-2 text-ink-ghost" />
          <p className="text-sm text-ink-faint">No providers yet.</p>
          <p className="mt-1 text-xs text-ink-ghost">
            Connect Claude, OpenAI, or a local OpenAI-compatible endpoint.
          </p>
        </div>
      )}

      {providers.map((p) => {
        const t = tests[p.id]
        const u = usageByProvider.get(p.id)
        return (
          <div key={p.id} className="rounded-2xl border border-line bg-surface/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  {p.hasKey ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-mint/12 px-2 py-0.5 text-[10px] text-mint">
                      <KeyRound size={10} /> key set
                    </span>
                  ) : p.kind === 'openai-compatible' ? (
                    <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] text-ink-faint">
                      no key needed
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber/12 px-2 py-0.5 text-[10px] text-amber-soft">
                      no key
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-faint">{KIND_LABEL[p.kind]}</p>
                {p.baseUrl && (
                  <p className="mt-0.5 font-mono text-[11px] text-ink-ghost">{p.baseUrl}</p>
                )}
                {(p.project || p.location) && (
                  <p className="mt-0.5 font-mono text-[11px] text-ink-ghost">
                    {[p.project, p.location].filter(Boolean).join(' · ')}
                  </p>
                )}
                {u && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-faint">
                    <Users size={11} className="text-ink-ghost" />
                    {u.library.length === 0 && u.agents.length === 0 ? (
                      <span className="text-ink-ghost">No personas use this provider</span>
                    ) : (
                      <span>
                        {u.library.length} persona{u.library.length === 1 ? '' : 's'}
                        {u.project.length !== u.library.length && (
                          <span className="text-ink-ghost"> ({u.project.length} in this project)</span>
                        )}
                        {u.agents.length > 0 && (
                          <span className="text-ink-ghost"> · {u.agents.join(' + ')}</span>
                        )}
                      </span>
                    )}
                  </p>
                )}
                {p.models && p.models.length > 0 ? (
                  <ProviderModels provider={p} usage={u} />
                ) : p.defaultModel ? (
                  <p className="mt-0.5 font-mono text-[11px] text-ink-ghost">
                    {p.defaultModel}
                    {u && (u.byModel.get(p.defaultModel)?.length ?? 0) > 0 && (
                      <span className="ml-1 text-ink-faint">· {u.byModel.get(p.defaultModel)!.length} persona(s)</span>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-ink-ghost">
                    Test the connection to load available models.
                  </p>
                )}
                {/* Models referenced by personas but NOT offered by the provider (cost/migration risk). */}
                {u && <GhostModels provider={p} usage={u} />}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={() => test(p.id)}>
                  {t?.state === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
                  Test
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1.5"
                  onClick={() => setEditing(p.id)}
                  aria-label="Edit"
                >
                  <Pencil size={13} />
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1.5 text-ink-faint hover:text-rose"
                  onClick={() => requestDelete(p)}
                  aria-label="Delete"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>

            {t && t.state !== 'loading' && (
              <div
                className={
                  'mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ' +
                  (t.state === 'ok' ? 'bg-mint/10 text-mint' : 'bg-rose/10 text-rose-soft')
                }
              >
                {t.state === 'ok' ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                ) : (
                  <XCircle size={14} className="mt-0.5 shrink-0" />
                )}
                <span className="selectable break-words">{t.message}</span>
              </div>
            )}
          </div>
        )
      })}

      {confirmDelete && (
        <DeleteProviderDialog
          provider={confirmDelete}
          usage={usageByProvider.get(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await deleteProvider(confirmDelete.id)
            setConfirmDelete(null)
          }}
        />
      )}
    </div>
  )
}

/** The provider's discovered models as clickable chips; the default is
 *  highlighted, and clicking another chip makes it the default. Each chip also
 *  shows how many personas use that exact model and lets you switch them all. */
function ProviderModels({ provider, usage }: { provider: ProviderConfig; usage?: ProviderUsage }) {
  const saveProvider = useKennel((s) => s.saveProvider)
  const [expanded, setExpanded] = useState(false)
  const [switchFrom, setSwitchFrom] = useState<string | null>(null)
  const models = provider.models ?? []
  const shown = expanded ? models : models.slice(0, 6)

  const setDefault = (m: string) => {
    if (m === provider.defaultModel) return
    void saveProvider({
      provider: {
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        project: provider.project,
        location: provider.location,
        defaultModel: m,
        models: provider.models
      }
    })
  }

  return (
    <div className="mt-1.5">
      <span className="text-[10px] uppercase tracking-wide text-ink-ghost">
        {models.length} model{models.length === 1 ? '' : 's'} · click to set default
      </span>
      <div className="mt-1 flex flex-wrap gap-1">
        {shown.map((m) => {
          const isDefault = m === provider.defaultModel
          const count = usage?.byModel.get(m)?.length ?? 0
          return (
            <span key={m} className="inline-flex items-center">
              <button
                onClick={() => setDefault(m)}
                title={isDefault ? 'Default model' : 'Set as default model'}
                className={clsx(
                  'no-drag rounded-l-md px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                  count > 0 ? 'rounded-r-none' : 'rounded-r-md',
                  isDefault
                    ? 'bg-mint/15 text-mint ring-1 ring-mint/40'
                    : 'bg-surface-overlay text-ink-faint hover:text-ink'
                )}
              >
                {m}
                {count > 0 && <span className="ml-1 text-ink-ghost">· {count}</span>}
              </button>
              {count > 0 && (
                <button
                  onClick={() => setSwitchFrom(m)}
                  title={`Reassign all ${count} persona(s) on "${m}" to another model`}
                  className="no-drag rounded-r-md border-l border-line bg-surface-overlay px-1 py-0.5 text-ink-ghost transition-colors hover:text-iris-soft"
                >
                  <ArrowRightLeft size={10} />
                </button>
              )}
            </span>
          )
        })}
        {models.length > 6 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="no-drag rounded-md px-1.5 py-0.5 text-[10px] text-ink-ghost hover:text-ink"
          >
            {expanded ? 'show less' : `+${models.length - 6} more`}
          </button>
        )}
      </div>
      {switchFrom && usage && (
        <SwitchModelDialog
          provider={provider}
          fromModel={switchFrom}
          usage={usage}
          onClose={() => setSwitchFrom(null)}
        />
      )}
    </div>
  )
}

/** Models personas reference that the provider does NOT offer — a cost/correctness
 *  risk worth migrating. Each is shown with its count and a switch affordance. */
function GhostModels({ provider, usage }: { provider: ProviderConfig; usage: ProviderUsage }) {
  const [switchFrom, setSwitchFrom] = useState<string | null>(null)
  // "Not offered" is only meaningful once we actually know the offered set — an
  // untested provider has no cached models, so don't flag everything as a ghost.
  if (!provider.models || provider.models.length === 0) return null
  const offered = new Set(provider.models)
  const ghosts = [...usage.byModel.entries()].filter(([m]) => m && !offered.has(m))
  if (ghosts.length === 0) return null
  return (
    <div className="mt-1.5 space-y-1">
      {ghosts.map(([m, personas]) => (
        <div
          key={m}
          className="flex items-center gap-1.5 rounded-md bg-amber/10 px-2 py-1 text-[10px] text-amber-soft"
        >
          <AlertTriangle size={10} className="shrink-0" />
          <span className="font-mono">{m || '(no model)'}</span>
          <span className="text-amber-soft/80">
            — {personas.length} persona(s) use a model not offered here
          </span>
          {m && (
            <button
              onClick={() => setSwitchFrom(m)}
              className="no-drag ml-auto rounded px-1 py-0.5 hover:text-iris-soft"
              title={`Reassign these ${personas.length} persona(s) to a valid model`}
            >
              <ArrowRightLeft size={10} />
            </button>
          )}
        </div>
      ))}
      {switchFrom && (
        <SwitchModelDialog
          provider={provider}
          fromModel={switchFrom}
          usage={usage}
          onClose={() => setSwitchFrom(null)}
        />
      )}
    </div>
  )
}

function ProviderForm({
  initial,
  onDone
}: {
  initial?: ProviderConfig
  onDone: () => void
}) {
  const saveProvider = useKennel((s) => s.saveProvider)
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<ProviderKind>(initial?.kind ?? 'anthropic')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [project, setProject] = useState(initial?.project ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const isVertex = kind === 'google-vertex'

  const onKindChange = (k: ProviderKind) => {
    setKind(k)
    if (k !== 'openai-compatible') setBaseUrl('')
    if (k !== 'google-vertex') {
      setProject('')
      setLocation('')
    }
  }

  const valid =
    name.trim().length > 0 && (kind !== 'openai-compatible' || baseUrl.trim().length > 0)

  const save = async () => {
    if (!valid) return
    setSaving(true)
    const id = initial?.id ?? crypto.randomUUID()
    // defaultModel/models are omitted — the store preserves any existing values
    // and a successful test populates them (auto-selecting the first as default).
    await saveProvider({
      provider: {
        id,
        name: name.trim(),
        kind,
        baseUrl: kind === 'openai-compatible' ? baseUrl.trim() : undefined,
        project: isVertex ? project.trim() || undefined : undefined,
        location: isVertex ? location.trim() || undefined : undefined
      },
      apiKey: apiKey ? apiKey : undefined
    })
    setSaving(false)
    // Best-effort: fetch the model list now so the dropdowns are populated and a
    // default is chosen automatically — no need to type a model id anywhere.
    const hasCreds =
      Boolean(apiKey) ||
      Boolean(initial?.hasKey) ||
      kind === 'openai-compatible' ||
      (isVertex && project.trim().length > 0 && location.trim().length > 0)
    if (hasCreds) void window.kennel.testProvider(id).catch(() => {})
    onDone()
  }

  return (
    <div className="space-y-4 p-5">
      <button onClick={onDone} className="no-drag text-xs text-ink-faint hover:text-ink">
        ← Back to providers
      </button>

      <div>
        <Label>Name</Label>
        <TextInput
          autoFocus
          placeholder="e.g. Claude (work)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <Label>Provider type</Label>
        <Select value={kind} onChange={(e) => onKindChange(e.target.value as ProviderKind)}>
          <option value="anthropic">{KIND_LABEL.anthropic}</option>
          <option value="openai">{KIND_LABEL.openai}</option>
          <option value="google">{KIND_LABEL.google}</option>
          <option value="google-vertex">{KIND_LABEL['google-vertex']}</option>
          <option value="openai-compatible">{KIND_LABEL['openai-compatible']}</option>
        </Select>
      </div>

      {kind === 'openai-compatible' && (
        <div>
          <Label>Base URL</Label>
          <TextInput
            placeholder="http://localhost:11434/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="font-mono text-[13px]"
          />
          <p className="mt-1 text-[11px] text-ink-ghost">
            Ollama, LM Studio, vLLM, or any OpenAI-compatible server.
          </p>
        </div>
      )}

      {kind === 'google' && (
        <p className="rounded-xl border border-line bg-surface/60 px-3 py-2 text-[11px] text-ink-faint">
          Use your Gemini API key from{' '}
          <span className="text-iris-soft">aistudio.google.com/apikey</span>.
        </p>
      )}

      {isVertex && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Project ID</Label>
            <TextInput
              placeholder="my-gcp-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="font-mono text-[13px]"
            />
          </div>
          <div>
            <Label>Location</Label>
            <TextInput
              placeholder="us-central1"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="font-mono text-[13px]"
            />
          </div>
          <p className="col-span-2 -mt-1 text-[11px] text-ink-ghost">
            Provide an API key below (express mode), or a Project ID + Location to use Application
            Default Credentials.
          </p>
        </div>
      )}

      <div>
        <Label>
          API key{' '}
          {(kind === 'openai-compatible' || isVertex) && (
            <span className="lowercase">(optional)</span>
          )}
        </Label>
        <TextInput
          type="password"
          placeholder={initial?.hasKey ? '•••••••• stored — leave blank to keep' : 'sk-…'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="font-mono text-[13px]"
        />
      </div>

      <p className="rounded-xl border border-line bg-surface/40 px-3 py-2 text-[11px] text-ink-faint">
        On save, Kennel fetches the available models from this provider and picks the first as the
        default — no model id to type. You can change the default from the provider card, and pick a
        model per persona / agent from a dropdown.
      </p>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!valid || saving} onClick={save}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : null}
          Save provider
        </Button>
      </div>
    </div>
  )
}

/** Confirm before deleting a provider that personas/agents depend on. */
function DeleteProviderDialog({
  provider,
  usage,
  onCancel,
  onConfirm
}: {
  provider: ProviderConfig
  usage?: ProviderUsage
  onCancel: () => void
  onConfirm: () => void
}) {
  const personas = usage?.library ?? []
  const agents = usage?.agents ?? []
  return (
    <Modal open onClose={onCancel} className="max-w-md" labelledBy="del-provider-title">
      <ModalHeader
        id="del-provider-title"
        title={`Delete “${provider.name}”?`}
        subtitle="This provider is in use — its dependents will lose their connection."
        onClose={onCancel}
      />
      <div className="space-y-3 p-5">
        <div className="flex items-start gap-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber-soft">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {personas.length > 0 && (
              <>
                {personas.length} persona{personas.length === 1 ? '' : 's'}
              </>
            )}
            {personas.length > 0 && agents.length > 0 && ' and '}
            {agents.length > 0 && <>the {agents.join(' & ')}</>} will be left without a provider until
            reassigned. Deleting does not remove them — they’ll show a “no provider” warning.
          </span>
        </div>
        {personas.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-lg border border-line">
            {personas.map((p) => (
              <div key={p.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-1.5 text-xs last:border-0">
                <span>{p.emoji}</span>
                <span className="text-ink">{p.name}</span>
                <span className="ml-auto font-mono text-[10px] text-ink-ghost">{p.model}</span>
                {p.scope === 'park' && (
                  <span className="rounded bg-iris/12 px-1 py-0.5 text-[9px] text-iris-soft">park</span>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-ink-ghost">
          Tip: use a model’s switch button on the provider card to move personas to another model
          first, or reassign them to a different provider before deleting.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" className="bg-rose/80 hover:bg-rose" onClick={onConfirm}>
            <Trash2 size={14} /> Delete anyway
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Reassign every persona on (provider, fromModel) to a chosen target model. */
function SwitchModelDialog({
  provider,
  fromModel,
  usage,
  onClose
}: {
  provider: ProviderConfig
  fromModel: string
  usage: ProviderUsage
  onClose: () => void
}) {
  const switchProviderModel = useKennel((s) => s.switchProviderModel)
  const options = (provider.models ?? []).filter((m) => m !== fromModel)
  const [toModel, setToModel] = useState(options[0] ?? '')
  const [scope, setScope] = useState<'project' | 'library'>('project')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)

  // Show the count that matches the CHOSEN scope (project subset vs whole library).
  const libraryCount = usage.byModel.get(fromModel)?.length ?? 0
  const projectCount = usage.project.filter((p) => p.model === fromModel).length
  const count = scope === 'project' ? projectCount : libraryCount

  const run = async () => {
    if (!toModel.trim()) return
    setBusy(true)
    const n = await switchProviderModel({ providerId: provider.id, fromModel, toModel: toModel.trim(), scope })
    setBusy(false)
    setDone(n)
  }

  return (
    <Modal open onClose={onClose} className="max-w-md" labelledBy="switch-model-title">
      <ModalHeader
        id="switch-model-title"
        title="Switch model"
        subtitle={`Move personas off “${fromModel}” on ${provider.name}`}
        onClose={onClose}
      />
      <div className="space-y-4 p-5">
        {done !== null ? (
          <div className="flex items-center gap-2 rounded-lg bg-mint/10 px-3 py-2 text-sm text-mint">
            <CheckCircle2 size={15} /> Switched {done} persona{done === 1 ? '' : 's'} to {toModel}.
          </div>
        ) : (
          <>
            <p className="text-xs text-ink-faint">
              {count} persona{count === 1 ? '' : 's'} currently use{count === 1 ? 's' : ''}{' '}
              <span className="font-mono text-ink-soft">{fromModel}</span>. Pick where to apply the
              switch and the new model.
            </p>
            <div>
              <Label>New model</Label>
              {options.length > 0 ? (
                <Select value={toModel} onChange={(e) => setToModel(e.target.value)}>
                  {options.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              ) : (
                <TextInput
                  placeholder="model id"
                  value={toModel}
                  onChange={(e) => setToModel(e.target.value)}
                  className="font-mono text-[13px]"
                />
              )}
            </div>
            <div>
              <Label>Apply to</Label>
              <div className="grid grid-cols-2 gap-2">
                <ScopeCard active={scope === 'project'} onClick={() => setScope('project')} title="This project" hint={`${projectCount} persona${projectCount === 1 ? '' : 's'} in the open project`} />
                <ScopeCard active={scope === 'library'} onClick={() => setScope('library')} title="All projects" hint={`${libraryCount} persona${libraryCount === 1 ? '' : 's'} everywhere`} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!toModel.trim() || busy || count === 0} onClick={run}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRightLeft size={14} />}
                Switch {count} persona{count === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}
        {done !== null && (
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ScopeCard({
  active,
  onClick,
  title,
  hint
}: {
  active: boolean
  onClick: () => void
  title: string
  hint: string
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'no-drag flex flex-col gap-0.5 rounded-xl border p-2.5 text-left transition-colors',
        active ? 'border-iris/50 bg-iris/10' : 'border-line hover:border-line-strong'
      )}
    >
      <span className={clsx('text-xs font-medium', active ? 'text-ink' : 'text-ink-soft')}>{title}</span>
      <span className="text-[10px] text-ink-faint">{hint}</span>
    </button>
  )
}
