import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Plus, Trash2 } from 'lucide-react'
import type {
  DeterministicInput,
  DeterministicProcess,
  ResultMatch,
  ResultStateKind,
  ResultStateRule
} from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { Button, COLORS, EMOJIS, Label, Modal, ModalHeader, Select, TextArea, TextInput } from '../ui'

const MATCH_LABEL: Record<ResultMatch, string> = {
  'exit-zero': 'Exit code is 0',
  'exit-nonzero': 'Exit code is non-zero',
  'exit-code': 'Exit code equals…',
  'output-contains': 'Output contains…',
  'output-matches': 'Output matches regex…',
  'spawn-error': 'Failed to start',
  default: 'Always (fallback)'
}

const KIND_COLOR: Record<ResultStateKind, string> = {
  success: 'text-mint',
  failure: 'text-rose',
  neutral: 'text-amber'
}

function defaultRules(): ResultStateRule[] {
  return [
    { state: 'success', kind: 'success', when: 'exit-zero' },
    { state: 'failed', kind: 'failure', when: 'exit-nonzero' },
    { state: 'failed to start', kind: 'failure', when: 'spawn-error' }
  ]
}

export function ProcessEditor({
  open,
  processId,
  onClose,
  defaultScope,
  ownerParkId
}: {
  open: boolean
  processId: string | null
  onClose: () => void
  /** Scope for a NEW process (undefined = canvas). Set 'park' to create a Park process. */
  defaultScope?: 'canvas' | 'park'
  /** Owning Park for a new park process (for per-project cross-park isolation). */
  ownerParkId?: string
}) {
  const existing = useKennel((s) => s.state?.deterministicProcesses.find((p) => p.id === processId))
  const saveProcess = useKennel((s) => s.saveProcess)

  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('⚙️')
  const [color, setColor] = useState(COLORS[2])
  const [description, setDescription] = useState('')
  const [command, setCommand] = useState('')
  const [inputs, setInputs] = useState<DeterministicInput[]>([])
  const [rules, setRules] = useState<ResultStateRule[]>(defaultRules())

  useEffect(() => {
    if (!open) return
    if (existing) {
      setName(existing.name)
      setEmoji(existing.emoji)
      setColor(existing.color)
      setDescription(existing.description ?? '')
      setCommand(existing.command)
      setInputs(existing.inputs)
      setRules(existing.resultRules.length ? existing.resultRules : defaultRules())
    } else {
      setName('')
      setEmoji('⚙️')
      setColor(COLORS[2])
      setDescription('')
      setCommand('')
      setInputs([])
      setRules(defaultRules())
    }
  }, [open, processId])

  const valid = name.trim() && command.trim()

  const save = async () => {
    if (!valid) return
    const proc: DeterministicProcess = {
      id: existing?.id ?? crypto.randomUUID(),
      name: name.trim(),
      emoji,
      color,
      description: description.trim() || undefined,
      command: command,
      inputs: inputs.filter((i) => i.name.trim()),
      resultRules: rules.filter((r) => r.state.trim()),
      // Preserve Park vs canvas scope + any tested I/O contract on edit; a NEW
      // process adopts defaultScope (and owning Park) from where it was created.
      ioContract: existing?.ioContract,
      scope: existing?.scope ?? defaultScope,
      ownerParkId: existing ? existing.ownerParkId : defaultScope === 'park' ? ownerParkId : undefined,
      createdAt: existing?.createdAt ?? Date.now()
    }
    await saveProcess(proc)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} className="flex h-[84vh] max-w-2xl flex-col" labelledBy="pe-title">
      <ModalHeader
        id="pe-title"
        title={existing ? 'Edit process' : 'New deterministic process'}
        subtitle="A reusable, parameterized command with result-state rules"
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-5">
        <div className="flex items-end gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl"
            style={{ background: `${color}22`, boxShadow: `inset 0 0 0 1px ${color}66` }}
          >
            {emoji}
          </div>
          <div className="flex-1">
            <Label>Name</Label>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lint & type-check" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Emoji</Label>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={clsx(
                    'no-drag flex h-8 w-8 items-center justify-center rounded-lg text-base',
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
                  className="no-drag h-8 w-8 rounded-lg"
                  style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <Label>Description</Label>
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" />
        </div>

        <div>
          <Label>Command</Label>
          <TextArea
            rows={2}
            className="font-mono text-[13px]"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npm run lint && npm run typecheck"
          />
          <p className="mt-1 text-[11px] text-ink-ghost">
            Use <code className="text-iris-soft">{'{{name}}'}</code> placeholders for inputs.
          </p>
        </div>

        {/* Inputs */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Inputs</Label>
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => setInputs((x) => [...x, { name: '', required: false }])}
            >
              <Plus size={13} /> Add input
            </Button>
          </div>
          <div className="space-y-2">
            {inputs.length === 0 && (
              <p className="text-[11px] text-ink-ghost">No inputs — the command runs as-is.</p>
            )}
            {inputs.map((inp, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl border border-line bg-surface/60 p-2">
                <TextInput
                  className="min-w-0 flex-1 font-mono text-[12px]"
                  placeholder="name"
                  value={inp.name}
                  onChange={(e) => setInputs((x) => x.map((v, j) => (j === i ? { ...v, name: e.target.value } : v)))}
                />
                <TextInput
                  className="min-w-0 flex-1"
                  placeholder="default (optional)"
                  value={inp.default ?? ''}
                  onChange={(e) => setInputs((x) => x.map((v, j) => (j === i ? { ...v, default: e.target.value } : v)))}
                />
                <button
                  onClick={() => setInputs((x) => x.map((v, j) => (j === i ? { ...v, required: !v.required } : v)))}
                  className={clsx(
                    'no-drag shrink-0 rounded-lg px-2 py-1.5 text-[11px]',
                    inp.required ? 'bg-iris/15 text-iris-soft' : 'bg-surface text-ink-faint'
                  )}
                >
                  {inp.required ? 'required' : 'optional'}
                </button>
                <button
                  onClick={() => setInputs((x) => x.filter((_, j) => j !== i))}
                  className="no-drag shrink-0 text-ink-ghost hover:text-rose"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Result rules */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Result states</Label>
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => setRules((x) => [...x, { state: '', kind: 'neutral', when: 'default' }])}
            >
              <Plus size={13} /> Add rule
            </Button>
          </div>
          <p className="mb-2 text-[11px] text-ink-ghost">
            Evaluated top to bottom; the first matching rule sets the node’s state.
          </p>
          <div className="space-y-2">
            {rules.map((r, i) => (
              <div key={i} className="rounded-xl border border-line bg-surface/60 p-2.5">
                <div className="flex items-center gap-2">
                  <TextInput
                    className={clsx('min-w-0 flex-1 font-medium', KIND_COLOR[r.kind])}
                    placeholder="state label"
                    value={r.state}
                    onChange={(e) => setRules((x) => x.map((v, j) => (j === i ? { ...v, state: e.target.value } : v)))}
                  />
                  <Select
                    className="w-32 shrink-0"
                    value={r.kind}
                    onChange={(e) =>
                      setRules((x) => x.map((v, j) => (j === i ? { ...v, kind: e.target.value as ResultStateKind } : v)))
                    }
                  >
                    <option value="success">success</option>
                    <option value="failure">failure</option>
                    <option value="neutral">neutral</option>
                  </Select>
                  <button
                    onClick={() => setRules((x) => x.filter((_, j) => j !== i))}
                    className="no-drag shrink-0 text-ink-ghost hover:text-rose"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] text-ink-faint">when</span>
                  <Select
                    className="min-w-0 flex-1"
                    value={r.when}
                    onChange={(e) =>
                      setRules((x) => x.map((v, j) => (j === i ? { ...v, when: e.target.value as ResultMatch } : v)))
                    }
                  >
                    {(Object.keys(MATCH_LABEL) as ResultMatch[]).map((m) => (
                      <option key={m} value={m}>
                        {MATCH_LABEL[m]}
                      </option>
                    ))}
                  </Select>
                  {r.when === 'exit-code' && (
                    <TextInput
                      type="number"
                      className="w-20 shrink-0 font-mono text-[12px]"
                      value={r.exitCode ?? 0}
                      onChange={(e) =>
                        setRules((x) => x.map((v, j) => (j === i ? { ...v, exitCode: Number(e.target.value) } : v)))
                      }
                    />
                  )}
                  {(r.when === 'output-contains' || r.when === 'output-matches') && (
                    <TextInput
                      className="min-w-0 flex-1 font-mono text-[12px]"
                      placeholder="pattern"
                      value={r.pattern ?? ''}
                      onChange={(e) =>
                        setRules((x) => x.map((v, j) => (j === i ? { ...v, pattern: e.target.value } : v)))
                      }
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!valid} onClick={save}>
          Save process
        </Button>
      </div>
    </Modal>
  )
}
