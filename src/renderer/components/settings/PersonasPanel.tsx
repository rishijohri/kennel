import { useState } from 'react'
import { clsx } from 'clsx'
import { Plus, Trash2, Pencil, FilePen, TerminalSquare, BrainCircuit, Loader2, Globe, Plug, X, LibraryBig, ArrowRightLeft, BadgeCheck } from 'lucide-react'
import type { AgentPersona, Effort, IoContract, Permissions, ProviderConfig } from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { Button, COLORS, EMOJIS, Label, Modal, ModalHeader, Select, TextArea, TextInput, Toggle } from '../ui'
import { ModelSelect } from '../ModelSelect'

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

type View = { mode: 'list' } | { mode: 'edit'; id: string | 'new' } | { mode: 'library' }

export function PersonasPanel() {
  // Settings manages canvas personas only; Park personas live in the Park sidebar.
  // NOTE: filter OUTSIDE the selector — a selector that builds a new array each
  // call makes Zustand's useSyncExternalStore loop forever ("Maximum update depth").
  const allPersonas = useKennel((s) => s.state?.personas ?? [])
  const allLibrary = useKennel((s) => s.state?.personaLibrary ?? [])
  const personas = allPersonas.filter((p) => p.scope !== 'park')
  const library = allLibrary.filter((p) => p.scope !== 'park')
  const providers = useKennel((s) => s.state?.providers ?? [])
  const removeFromProject = useKennel((s) => s.removePersonaFromProject)
  const addToProject = useKennel((s) => s.addPersonaToProject)
  const deleteFromLibrary = useKennel((s) => s.deletePersonaFromLibrary)
  const [view, setView] = useState<View>({ mode: 'list' })

  if (view.mode === 'edit') {
    const initial = view.id === 'new' ? undefined : library.find((p) => p.id === view.id)
    return <PersonaForm initial={initial} onDone={() => setView({ mode: 'list' })} />
  }

  if (view.mode === 'library') {
    return (
      <PersonaLibraryPicker
        library={library}
        inProject={new Set(personas.map((p) => p.id))}
        providers={providers}
        onAdd={(id) => void addToProject(id)}
        onDelete={(id) => void deleteFromLibrary(id)}
        onBack={() => setView({ mode: 'list' })}
      />
    )
  }

  const available = library.filter((p) => !personas.some((q) => q.id === p.id)).length

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">Personas available in this project.</p>
        <div className="flex items-center gap-1.5">
          <Button variant="subtle" onClick={() => setView({ mode: 'library' })} className="text-xs">
            <LibraryBig size={14} />
            Add existing{available > 0 ? ` (${available})` : ''}
          </Button>
          <Button variant="primary" onClick={() => setView({ mode: 'edit', id: 'new' })} className="text-xs">
            <Plus size={15} />
            New persona
          </Button>
        </div>
      </div>

      {personas.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-ink-ghost">
          No personas in this project yet. Create one, or add an existing one from the library.
        </p>
      )}

      {personas.map((p) => {
        const provider = providers.find((v) => v.id === p.providerId)
        return (
          <div key={p.id} className="rounded-2xl border border-line bg-surface/60 p-4">
            <div className="flex items-start gap-3">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
                style={{ background: `${p.color}22`, boxShadow: `inset 0 0 0 1px ${p.color}55` }}
              >
                {p.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  <span className="rounded-full bg-surface-overlay px-2 py-0.5 font-mono text-[10px] text-ink-faint">
                    {p.model}
                  </span>
                </div>
                {p.role && <p className="mt-0.5 text-xs text-ink-faint">{p.role}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <PermChip on={p.permissions.canEditFiles} icon={<FilePen size={11} />}>
                    Edit files
                  </PermChip>
                  <PermChip on={p.permissions.canRunBash} icon={<TerminalSquare size={11} />}>
                    Run shell
                  </PermChip>
                  <PermChip on={p.permissions.canEditCoreMemory} icon={<BrainCircuit size={11} />}>
                    Core memory
                  </PermChip>
                  <PermChip on={p.permissions.canSearchWeb} icon={<Globe size={11} />}>
                    Web search
                  </PermChip>
                  <PermChip on={p.permissions.canUseMcp} icon={<Plug size={11} />}>
                    MCP
                  </PermChip>
                  {!provider && (
                    <span className="rounded-full bg-amber/12 px-2 py-0.5 text-[10px] text-amber-soft">
                      no provider
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" className="px-2 py-1.5" onClick={() => setView({ mode: 'edit', id: p.id })}>
                  <Pencil size={13} />
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1.5 text-ink-faint hover:text-rose"
                  title="Remove from this project (keeps it in the library)"
                  onClick={() => void removeFromProject(p.id)}
                >
                  <X size={14} />
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PersonaLibraryPicker({
  library,
  inProject,
  providers,
  onAdd,
  onDelete,
  onBack
}: {
  library: AgentPersona[]
  inProject: Set<string>
  providers: ProviderConfig[]
  onAdd: (id: string) => void
  onDelete: (id: string) => void
  onBack: () => void
}) {
  return (
    <div className="space-y-3 p-5">
      <button onClick={onBack} className="no-drag text-xs text-ink-faint hover:text-ink">
        ← Back to project personas
      </button>
      <p className="text-sm text-ink-soft">
        The persona library — every persona you’ve created. Add one to this project, or delete it
        from the library entirely.
      </p>

      {library.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-ink-ghost">
          The library is empty. Create a persona to add it here.
        </p>
      )}

      {library.map((p) => {
        const added = inProject.has(p.id)
        const provider = providers.find((v) => v.id === p.providerId)
        return (
          <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface/60 p-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
              style={{ background: `${p.color}22`, boxShadow: `inset 0 0 0 1px ${p.color}55` }}
            >
              {p.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{p.name}</span>
              <span className="block truncate text-[11px] text-ink-faint">
                {p.role || provider?.name || p.model}
              </span>
            </div>
            {added ? (
              <span className="shrink-0 rounded-full bg-mint/12 px-2.5 py-1 text-[11px] text-mint">
                in project
              </span>
            ) : (
              <Button variant="subtle" className="shrink-0 text-xs" onClick={() => onAdd(p.id)}>
                <Plus size={13} />
                Add
              </Button>
            )}
            <Button
              variant="ghost"
              className="shrink-0 px-2 py-1.5 text-ink-faint hover:text-rose"
              title="Delete from the library (removes it from every project)"
              onClick={() => onDelete(p.id)}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function PermChip({
  on,
  icon,
  children
}: {
  on: boolean
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]',
        on ? 'bg-mint/12 text-mint' : 'bg-surface-overlay text-ink-ghost line-through'
      )}
    >
      {icon}
      {children}
    </span>
  )
}

export function PersonaForm({
  initial,
  onDone,
  inModal,
  createScope,
  ownerParkId
}: {
  initial?: AgentPersona
  onDone: () => void
  /** When rendered inside a Modal, hide the inline "← Back" link (the Modal closes). */
  inModal?: boolean
  /** Scope for a NEW persona (undefined = canvas). Set 'park' to create a Park persona. */
  createScope?: 'canvas' | 'park'
  /** Owning Park for a new park persona (for per-project cross-park isolation). */
  ownerParkId?: string
}) {
  const savePersona = useKennel((s) => s.savePersona)
  const providers = useKennel((s) => s.state?.providers ?? [])

  const [name, setName] = useState(initial?.name ?? '')
  const [role, setRole] = useState(initial?.role ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? EMOJIS[0])
  const [color, setColor] = useState(initial?.color ?? COLORS[0])
  // Use `||` not `??`: default personas ship with providerId '' (not nullish),
  // so they must still adopt the first available provider.
  const [providerId, setProviderId] = useState(initial?.providerId || providers[0]?.id || '')
  const [model, setModel] = useState(
    initial?.model || providers.find((p) => p.id === (initial?.providerId || providers[0]?.id))?.defaultModel || ''
  )
  // ModelSelect needs to re-derive its default when the provider changes; we
  // also reset the model so it adopts the new provider's first model.
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? '')
  const [perms, setPerms] = useState<Permissions>({
    canEditFiles: false,
    canRunBash: false,
    canEditCoreMemory: false,
    canSearchWeb: false,
    canUseMcp: false,
    ...initial?.permissions
  })
  const [effort, setEffort] = useState<Effort>(initial?.effort ?? 'high')
  const [saving, setSaving] = useState(false)

  const onProvider = (id: string) => {
    setProviderId(id)
    // Adopt the new provider's default; ModelSelect fills the first model if empty.
    setModel(providers.find((p) => p.id === id)?.defaultModel ?? '')
  }

  const valid = name.trim() && providerId && model.trim()

  const save = async () => {
    if (!valid) return
    setSaving(true)
    const persona: AgentPersona = {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      role: role.trim() || undefined,
      emoji,
      color,
      providerId,
      model: model.trim(),
      systemPrompt: systemPrompt.trim(),
      permissions: perms,
      effort,
      // Preserve Park scope + its tested I/O contract on edit (don't demote a Park
      // persona); a NEW persona adopts createScope (+ owning Park) from where it
      // was created. Keep builtin/ownerParkId on edit.
      scope: initial?.scope ?? createScope,
      ownerParkId: initial ? initial.ownerParkId : createScope === 'park' ? ownerParkId : undefined,
      builtin: initial?.builtin,
      ioContract: initial?.ioContract
    }
    await savePersona(persona)
    setSaving(false)
    onDone()
  }

  return (
    <div className="space-y-4 p-5">
      {!inModal && (
        <button onClick={onDone} className="no-drag text-xs text-ink-faint hover:text-ink">
          ← Back to personas
        </button>
      )}

      {inModal && initial?.ioContract && <ContractSummary contract={initial.ioContract} />}

      <div className="flex items-end gap-3">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl"
          style={{ background: `${color}22`, boxShadow: `inset 0 0 0 1px ${color}66` }}
        >
          {emoji}
        </div>
        <div className="flex-1">
          <Label>Name</Label>
          <TextInput
            autoFocus
            placeholder="e.g. Reviewer"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label>Tagline</Label>
        <TextInput
          placeholder="One line describing this persona"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Avatar</Label>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={clsx(
                  'no-drag flex h-8 w-8 items-center justify-center rounded-lg text-base transition-all',
                  emoji === e ? 'bg-surface-overlay ring-2 ring-iris' : 'hover:bg-surface-hover'
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Color</Label>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={clsx(
                  'no-drag h-8 w-8 rounded-lg transition-all',
                  color === c ? 'ring-2 ring-offset-2 ring-offset-surface-raised' : ''
                )}
                style={{ background: c, ...(color === c ? { boxShadow: `0 0 0 2px ${c}` } : {}) }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Provider</Label>
          {providers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-2 text-xs text-amber-soft">
              Add a provider first
            </p>
          ) : (
            <Select value={providerId} onChange={(e) => onProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div>
          <Label>Model</Label>
          <ModelSelect providerId={providerId} value={model} onChange={setModel} />
        </div>
      </div>

      <div>
        <Label>System prompt</Label>
        <TextArea
          rows={4}
          placeholder="Describe how this agent should behave…"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </div>

      <div>
        <Label>Permissions</Label>
        <div className="space-y-2">
          <Toggle
            label="Edit files"
            hint="Create, modify, and delete files in the working tree"
            checked={perms.canEditFiles}
            accent={color}
            onChange={(v) => setPerms((p) => ({ ...p, canEditFiles: v }))}
          />
          <Toggle
            label="Run shell commands"
            hint="Execute bash — builds, tests, installs, git"
            checked={perms.canRunBash}
            accent={color}
            onChange={(v) => setPerms((p) => ({ ...p, canRunBash: v }))}
          />
          <Toggle
            label="Edit core memory"
            hint="Modify the protected KENNEL.md and .kennel/ location"
            checked={perms.canEditCoreMemory}
            accent={color}
            onChange={(v) => setPerms((p) => ({ ...p, canEditCoreMemory: v }))}
          />
          <Toggle
            label="Internet search"
            hint="Search the web with the built-in search tool"
            checked={perms.canSearchWeb}
            accent={color}
            onChange={(v) => setPerms((p) => ({ ...p, canSearchWeb: v }))}
          />
          <Toggle
            label="MCP access"
            hint="Use tools from the MCP servers configured in settings"
            checked={perms.canUseMcp}
            accent={color}
            onChange={(v) => setPerms((p) => ({ ...p, canUseMcp: v }))}
          />
        </div>
      </div>

      <div>
        <Label>Reasoning effort</Label>
        <div className="grid grid-cols-5 gap-1.5 rounded-xl border border-line bg-surface p-1">
          {EFFORTS.map((e) => (
            <button
              key={e}
              onClick={() => setEffort(e)}
              className={clsx(
                'no-drag rounded-lg py-1.5 text-xs font-medium capitalize transition-all',
                effort === e ? 'bg-surface-overlay text-ink shadow-node' : 'text-ink-faint hover:text-ink-soft'
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-ink-ghost">
          Higher effort = deeper reasoning (Claude / reasoning models).
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!valid || saving} onClick={save}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : null}
          Save persona
        </Button>
      </div>
    </div>
  )
}

/** Read-only summary of a persona's XCom I/O contract (shown for Park personas). */
function ContractSummary({ contract }: { contract: IoContract }) {
  const Row = ({ f, tone }: { f: IoContract['inputs'][number]; tone: string }) => (
    <div className="rounded-md border border-line bg-surface/60 px-2 py-1 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className={clsx('font-mono', tone)}>{f.key}</span>
        <span className="text-[10px] text-ink-ghost">{f.format}</span>
      </div>
      {f.example && <div className="mt-0.5 truncate text-[10px] text-ink-ghost">e.g. {f.example}</div>}
    </div>
  )
  return (
    <div className="rounded-xl border border-iris/20 bg-iris/[0.05] p-3">
      <div className="mb-2 flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-wide text-iris-soft">
        <ArrowRightLeft size={12} /> I/O contract (XCom)
        <span
          className={clsx(
            'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px]',
            contract.tested ? 'bg-mint/12 text-mint' : 'bg-amber/12 text-amber-soft'
          )}
        >
          {contract.tested && <BadgeCheck size={10} />}
          {contract.tested ? 'tested' : 'untested'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="text-[10px] text-ink-faint">Inputs</div>
          {contract.inputs.length === 0 ? (
            <p className="text-[10px] text-ink-ghost">none</p>
          ) : (
            contract.inputs.map((f) => <Row key={f.key} f={f} tone="text-iris-soft" />)
          )}
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-ink-faint">Outputs</div>
          {contract.outputs.length === 0 ? (
            <p className="text-[10px] text-ink-ghost">none</p>
          ) : (
            contract.outputs.map((f) => <Row key={f.key} f={f} tone="text-mint" />)
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Open a single persona's full details/editor as a Modal — the same form used in
 * Settings. Used by the sidebar (canvas AND Park) so editing any persona shows
 * its details directly, rather than diving into settings.
 */
export function PersonaEditorModal({
  persona,
  onClose
}: {
  persona: AgentPersona | null
  onClose: () => void
}) {
  return (
    <Modal
      open={Boolean(persona)}
      onClose={onClose}
      className="flex h-[86vh] max-w-xl flex-col"
      labelledBy="persona-edit-title"
    >
      <ModalHeader
        id="persona-edit-title"
        title={persona?.scope === 'park' ? `Park persona — ${persona?.name ?? ''}` : 'Edit persona'}
        subtitle={
          persona?.scope === 'park'
            ? 'Used as a workflow node with an I/O contract'
            : 'A reusable agent persona'
        }
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {persona && <PersonaForm initial={persona} onDone={onClose} inModal />}
      </div>
    </Modal>
  )
}

/**
 * Create a NEW persona in a given scope as a Modal (same form as Settings). Used
 * by the Park sidebar's "+" to add a Park-scoped persona owned by the open Park.
 */
export function PersonaCreateModal({
  open,
  scope,
  ownerParkId,
  onClose
}: {
  open: boolean
  scope: 'canvas' | 'park'
  ownerParkId?: string
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} className="flex h-[86vh] max-w-xl flex-col" labelledBy="persona-create-title">
      <ModalHeader
        id="persona-create-title"
        title={scope === 'park' ? 'New Park persona' : 'New persona'}
        subtitle={scope === 'park' ? 'A reusable agent for this project’s Park workflows' : 'A reusable agent persona'}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {open && <PersonaForm onDone={onClose} inModal createScope={scope} ownerParkId={ownerParkId} />}
      </div>
    </Modal>
  )
}
