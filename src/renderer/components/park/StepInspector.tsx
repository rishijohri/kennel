import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { GitBranch, X, Save, Trash2, ChevronDown, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, BadgeCheck } from 'lucide-react'
import type { ActivationCondition, ActivationField, ActivationOp, IoContract, Park, WorkflowNode } from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { Spinner } from '../ui'
import { FIELD_OPTIONS, OP_OPTIONS, opNeedsValue } from './activation'

/** Ancestors of `node` (nearest first) — the steps whose output a condition can test. */
function ancestorsOf(park: Park, nodeId: string): WorkflowNode[] {
  const byId = new Map(park.nodes.map((n) => [n.id, n]))
  const out: WorkflowNode[] = []
  let cur = byId.get(nodeId)?.parentId ?? null
  while (cur) {
    const n = byId.get(cur)
    if (!n || n.kind === 'start') break
    out.push(n)
    cur = n.parentId
  }
  return out
}

const selectCls =
  'no-drag w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[12px] text-ink outline-none focus:border-iris'

export function StepInspector({ park, node, onClose }: { park: Park; node: WorkflowNode; onClose: () => void }) {
  const updateWorkflowNode = useKennel((s) => s.updateWorkflowNode)
  const personas = useKennel((s) => s.state?.personas ?? [])
  const processes = useKennel((s) => s.state?.deterministicProcesses ?? [])
  const ancestors = useMemo(() => ancestorsOf(park, node.id), [park, node.id])
  const parent = park.nodes.find((n) => n.id === node.parentId)

  // The XCom I/O contract the node inherits from its capability (persona/process).
  const contract: IoContract | undefined =
    node.kind === 'agentic'
      ? personas.find((p) => p.id === node.personaId)?.ioContract
      : node.kind === 'deterministic'
        ? processes.find((p) => p.id === node.processId)?.ioContract
        : undefined

  // A Report step's writer — the persona (agentic) or process (deterministic)
  // that turns the run's results into the report.
  const reportPersona = node.kind === 'report' ? personas.find((p) => p.id === node.personaId) : undefined
  const reportProcess = node.kind === 'report' ? processes.find((p) => p.id === node.processId) : undefined
  // A deterministic step runs a registered process; its command lives on the
  // process (the node's ad-hoc command is cleared when it is registered).
  const stepProcess = node.kind === 'deterministic' ? processes.find((p) => p.id === node.processId) : undefined
  const commandText = node.command ?? stepProcess?.command
  const titleById = useMemo(() => new Map(park.nodes.map((n) => [n.id, n.title])), [park.nodes])

  // ── Declared output ──
  const [outputSpec, setOutputSpec] = useState(node.outputSpec ?? '')
  useEffect(() => setOutputSpec(node.outputSpec ?? ''), [node.id, node.outputSpec])
  const specDirty = outputSpec.trim() !== (node.outputSpec ?? '')

  // ── Activation condition ──
  const [editing, setEditing] = useState(false)
  const [source, setSource] = useState<string>('')
  const [field, setField] = useState<ActivationField>('resultStateKind')
  const [op, setOp] = useState<ActivationOp>('eq')
  const [value, setValue] = useState('')

  useEffect(() => {
    const a = node.activation
    setEditing(false)
    setSource(a?.sourceNodeId ?? '')
    setField(a?.field ?? 'resultStateKind')
    setOp(a?.op ?? 'eq')
    setValue(a?.value ?? '')
  }, [node.id, node.activation])

  const saveCondition = () => {
    const cond: ActivationCondition = { field, op }
    if (source) cond.sourceNodeId = source
    if (opNeedsValue(op)) cond.value = value
    void updateWorkflowNode(park.id, node.id, { activation: cond })
    setEditing(false)
  }
  const clearCondition = () => {
    void updateWorkflowNode(park.id, node.id, { activation: undefined })
    setEditing(false)
  }

  const kindLabel = node.kind === 'agentic' ? 'Agentic step' : node.kind === 'report' ? 'Report step' : 'Deterministic step'

  const lastRun = park.lastRun
  const hasResult = node.status != null && node.status !== 'idle'
  const activated = (lastRun?.results ?? []).find((r) => r.nodeId === node.id)?.activated

  return (
    <div className="absolute bottom-0 right-0 top-0 z-10 m-3 flex w-[480px] max-w-[calc(100%-1.5rem)] flex-col rounded-xl border border-line bg-surface-overlay shadow-node">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{node.title}</div>
          <div className="text-[10.5px] text-ink-ghost">{kindLabel}</div>
        </div>
        <button onClick={onClose} className="no-drag rounded p-1 text-ink-ghost hover:text-ink">
          <X size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3.5">
        {/* Report writer (how the run's results are turned into the report) */}
        {node.kind === 'report' && (
          <Section label="Report writer">
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface/60 px-2.5 py-2">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm"
                style={{
                  background: `${reportPersona?.color ?? '#56d6a0'}22`,
                  boxShadow: `inset 0 0 0 1px ${reportPersona?.color ?? '#56d6a0'}55`
                }}
              >
                {reportProcess ? reportProcess.emoji : reportPersona?.emoji ?? '📝'}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-ink">
                  {reportProcess?.name ?? reportPersona?.name ?? 'Unassigned'}
                </div>
                <div className="truncate text-[10px] text-ink-ghost">
                  {reportProcess
                    ? `process · $ ${reportProcess.command}`
                    : reportPersona
                      ? `persona · ${reportPersona.model}`
                      : 'No writer — reassign this step.'}
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-ghost">
              Synthesizes a report from every step’s output (failures and skipped branches included).
            </p>
          </Section>
        )}

        {/* Declared output */}
        {node.kind !== 'report' && (
          <Section label="Output — what this step produces">
            <input
              value={outputSpec}
              onChange={(e) => setOutputSpec(e.target.value)}
              placeholder="e.g. list of failing tests"
              className={selectCls}
            />
            {specDirty && (
              <button
                onClick={() => void updateWorkflowNode(park.id, node.id, { outputSpec: outputSpec.trim() })}
                className="no-drag mt-1.5 inline-flex items-center gap-1 rounded-md bg-iris/15 px-2 py-1 text-[11px] font-medium text-iris-soft hover:bg-iris/25"
              >
                <Save size={11} /> Save
              </button>
            )}
          </Section>
        )}

        {/* Activation condition */}
        <Section label="Runs when (branch condition)">
          {!node.activation && !editing ? (
            <button
              onClick={() => setEditing(true)}
              className="no-drag flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-2 text-[11px] text-ink-faint hover:border-line-strong hover:text-ink-soft"
            >
              <GitBranch size={12} /> Always runs — add a condition
            </button>
          ) : editing ? (
            <div className="space-y-2">
              <div>
                <FieldLabel>Test the result of</FieldLabel>
                <select value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
                  <option value="">{parent ? `Parent — ${parent.title}` : 'Parent step'}</option>
                  {ancestors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel>Field</FieldLabel>
                  <select value={field} onChange={(e) => setField(e.target.value as ActivationField)} className={selectCls}>
                    {FIELD_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Is</FieldLabel>
                  <select value={op} onChange={(e) => setOp(e.target.value as ActivationOp)} className={selectCls}>
                    {OP_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {opNeedsValue(op) && (
                <div>
                  <FieldLabel>Value</FieldLabel>
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={field === 'resultStateKind' ? 'failure' : field === 'exitCode' ? '0' : 'value'}
                    className={selectCls}
                  />
                </div>
              )}
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  onClick={saveCondition}
                  className="no-drag inline-flex items-center gap-1 rounded-md bg-iris/15 px-2.5 py-1 text-[11px] font-medium text-iris-soft hover:bg-iris/25"
                >
                  <Save size={11} /> Save condition
                </button>
                {node.activation && (
                  <button
                    onClick={clearCondition}
                    className="no-drag inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-faint hover:text-rose"
                  >
                    <Trash2 size={11} /> Remove
                  </button>
                )}
                <button onClick={() => setEditing(false)} className="no-drag ml-auto px-2 py-1 text-[11px] text-ink-ghost hover:text-ink-soft">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="no-drag flex w-full items-center gap-2 rounded-md border border-iris/40 bg-iris/10 px-2.5 py-2 text-left text-[11px] text-iris-soft hover:bg-iris/15"
            >
              <GitBranch size={12} className="shrink-0" />
              <span className="font-mono">
                {(node.activation!.sourceNodeId
                  ? park.nodes.find((n) => n.id === node.activation!.sourceNodeId)?.title ?? 'source'
                  : parent?.title ?? 'parent') +
                  ` · ${node.activation!.field} ${node.activation!.op} ${node.activation!.value ?? ''}`}
              </span>
            </button>
          )}
        </Section>

        {/* XCom I/O contract */}
        {contract && (contract.inputs.length > 0 || contract.outputs.length > 0) && (
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-ink-ghost">
                <ArrowRightLeft size={11} /> I/O contract (XCom)
              </span>
              {contract.tested ? (
                <span
                  className="flex items-center gap-0.5 rounded bg-mint/12 px-1.5 py-0.5 text-[9px] font-medium text-mint"
                  title={contract.testNotes || 'Verified by the Care Taker'}
                >
                  <BadgeCheck size={10} /> tested
                </span>
              ) : (
                <span className="rounded bg-amber/12 px-1.5 py-0.5 text-[9px] text-amber-soft">untested</span>
              )}
            </div>
            {contract.inputs.length > 0 && (
              <div className="mb-2 space-y-1">
                <div className="flex items-center gap-1 text-[10px] text-ink-faint">
                  <ArrowDownToLine size={10} /> Inputs
                </div>
                {contract.inputs.map((f) => {
                  const bind = node.inputBindings?.[f.key]
                  return (
                    <div key={f.key} className="rounded-md border border-line bg-surface/60 px-2 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-iris-soft">{f.key}</span>
                        <span className="text-[10px] text-ink-ghost">{f.format}</span>
                      </div>
                      {f.example && <div className="mt-0.5 truncate text-[10px] text-ink-ghost">e.g. {f.example}</div>}
                      <div className="mt-0.5 text-[10px]">
                        {bind ? (
                          <span className="text-mint">← {titleById.get(bind.sourceNodeId) ?? bind.sourceNodeId}.{bind.key}</span>
                        ) : (
                          <span className="text-amber-soft">unbound</span>
                        )}
                      </div>
                      {node.inputsReceived?.[f.key] != null && (
                        <div className="mt-1 rounded bg-surface/80 px-1.5 py-1">
                          <div className="text-[9px] uppercase tracking-wide text-ink-ghost">received</div>
                          <div className="selectable max-h-16 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-soft">
                            {node.inputsReceived[f.key] || '(empty)'}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {contract.outputs.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[10px] text-ink-faint">
                  <ArrowUpFromLine size={10} /> Outputs
                </div>
                {contract.outputs.map((f) => (
                  <div key={f.key} className="rounded-md border border-line bg-surface/60 px-2 py-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-mint">{f.key}</span>
                      <span className="text-[10px] text-ink-ghost">{f.format}</span>
                    </div>
                    {f.example && <div className="mt-0.5 truncate text-[10px] text-ink-ghost">e.g. {f.example}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Prompt / command */}
        {(node.prompt || commandText) && (
          <Section
            label={
              node.kind === 'deterministic'
                ? stepProcess
                  ? `Command — process “${stepProcess.name}”`
                  : 'Command'
                : 'Prompt'
            }
          >
            <pre className="selectable max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-surface/60 p-2 font-mono text-[11px] text-ink-faint">
              {node.prompt ?? commandText}
            </pre>
          </Section>
        )}

        {/* Result */}
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-ghost">Last run</span>
            {hasResult && lastRun && (
              <span
                className={clsx(
                  'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                  lastRun.mode === 'recorded' ? 'bg-iris/15 text-iris-soft' : 'bg-amber/12 text-amber-soft'
                )}
                title={
                  lastRun.mode === 'recorded'
                    ? 'From a recorded run (in history)'
                    : 'From a temporary run — kept until the next run'
                }
              >
                {lastRun.mode}
              </span>
            )}
            {activated === false && (
              <span
                className="rounded bg-amber/12 px-1.5 py-0.5 text-[9px] text-amber-soft"
                title="This step's own activation condition was false"
              >
                branch off
              </span>
            )}
          </div>
          {node.status === 'running' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-iris-soft">
                <Spinner size={12} /> running…
              </div>
              {node.output && (
                <pre className="selectable max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-[#0a0b10] p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-faint">
                  {node.output}
                </pre>
              )}
            </div>
          ) : node.status === 'skipped' ? (
            <p className="text-xs text-amber-soft">
              {activated === false
                ? "Skipped — this step's activation condition was false."
                : 'Skipped — an upstream branch was not taken.'}
            </p>
          ) : node.outputValue || node.output || node.outputs ? (
            <div className="space-y-2">
              {node.outputs && Object.keys(node.outputs).filter((k) => k !== 'return_value').length > 0 && (
                <div className="space-y-1">
                  {Object.entries(node.outputs)
                    .filter(([k]) => k !== 'return_value')
                    .map(([k, v]) => (
                      <div key={k} className="rounded-md border border-line bg-surface/60 px-2 py-1.5">
                        <div className="font-mono text-[10px] text-mint">{k}</div>
                        <div className="selectable mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-soft">
                          {v}
                        </div>
                      </div>
                    ))}
                </div>
              )}
              {node.outputValue && (
                <pre className="selectable max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-[#0a0b10] p-2.5 font-mono text-[11px] leading-relaxed text-ink-soft">
                  {node.outputValue}
                </pre>
              )}
              {node.output && node.output !== node.outputValue && <RawLog text={node.output} />}
            </div>
          ) : (
            <p className="text-xs text-ink-ghost">No output yet — run the workflow.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function RawLog({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="no-drag flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink-soft"
      >
        <ChevronDown size={12} className={clsx('transition-transform', open && 'rotate-180')} /> Activity log
      </button>
      {open && (
        <pre className="selectable mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface/60 p-2 font-mono text-[10.5px] leading-relaxed text-ink-faint">
          {text}
        </pre>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-ghost">{label}</div>
      {children}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] text-ink-ghost">{children}</div>
}
