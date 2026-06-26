import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Sparkles,
  TerminalSquare,
  KeyRound,
  FilePen,
  BrainCircuit,
  Loader2,
  SquareTerminal,
  Play,
  Workflow,
  Zap,
  Clock,
  Plus,
  Globe,
  Plug,
  ChevronRight,
  FileText
} from 'lucide-react'
import { useKennel } from '../store/useKennel'
import { parkCapVisible } from '@shared/park-scope'
import type { ParkKind } from '@shared/types'
import { Button } from './ui'
import { AgentStage } from './agent/AgentStage'
import { PromptBox, type StageAccent } from './agent/PromptBox'
import { FloatingField } from './agent/FloatingField'

type Mode = 'agentic' | 'deterministic' | 'park' | 'report'
type DetKind = 'process' | 'command'
/** How a Report step's writer processes the run — an agentic persona or a process. */
type ReportWriter = 'persona' | 'process'

type Stage =
  | 'mode'
  | 'agentic-persona'
  | 'agentic-prompt'
  | 'report-writer'
  | 'report-pick'
  | 'det-kind'
  | 'det-process'
  | 'det-command'
  | 'park-form'

const MODE_COLOR: Record<Mode, string> = {
  agentic: '#7c6cff',
  deterministic: '#ffb454',
  park: '#56b6ff',
  report: '#56d6a0'
}
const MODE_ACCENT: Record<Mode, StageAccent> = {
  agentic: 'iris',
  deterministic: 'blue',
  park: 'blue',
  report: 'mint'
}

const firstStage: Record<Mode, Stage> = {
  agentic: 'agentic-persona',
  report: 'report-writer',
  deterministic: 'det-kind',
  park: 'park-form'
}

export function RunLauncher() {
  const launcher = useKennel((s) => s.launcher)
  const close = useKennel((s) => s.closeLauncher)
  const allPersonas = useKennel((s) => s.state?.personas ?? [])
  const providers = useKennel((s) => s.state?.providers ?? [])
  const allProcesses = useKennel((s) => s.state?.deterministicProcesses ?? [])
  const nodeById = useKennel((s) => s.nodeById)
  const runAgentic = useKennel((s) => s.runAgentic)
  const runDeterministic = useKennel((s) => s.runDeterministic)
  const runProcess = useKennel((s) => s.runProcess)
  const createParkNode = useKennel((s) => s.createParkNode)
  const openPark = useKennel((s) => s.openPark)
  const addWorkflowStep = useKennel((s) => s.addWorkflowStep)
  const openCaretaker = useKennel((s) => s.openCaretaker)
  const openSettings = useKennel((s) => s.openSettings)
  const running = useKennel((s) => s.running)
  const anyRunning = Object.keys(running).length > 0

  // When parkId is set, the launcher ADDS a workflow step (no immediate run).
  const parkId = launcher?.parkId
  // Park steps draw from the SEPARATE Park pool of personas/processes, narrowed
  // to this Park when the project disables cross-park sharing.
  const shareParkCaps = useKennel((s) => s.state?.project?.shareParkCapabilities) !== false
  const personas = allPersonas.filter((p) =>
    parkId ? parkCapVisible(p, parkId, shareParkCaps) : p.scope !== 'park'
  )
  const processes = allProcesses.filter((p) =>
    parkId ? parkCapVisible(p, parkId, shareParkCaps) : p.scope !== 'park'
  )

  const [mode, setMode] = useState<Mode>('agentic')
  const [stage, setStage] = useState<Stage>('mode')
  const [personaId, setPersonaId] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [outputSpec, setOutputSpec] = useState('')
  const [title, setTitle] = useState('')
  const [command, setCommand] = useState('')
  const [detKind, setDetKind] = useState<DetKind>('process')
  const [reportWriter, setReportWriter] = useState<ReportWriter>('persona')
  const [processId, setProcessId] = useState('')
  const [processInputs, setProcessInputs] = useState<Record<string, string>>({})
  const [parkName, setParkName] = useState('')
  const [parkKind, setParkKind] = useState<ParkKind>('trigger')
  const [busy, setBusy] = useState(false)

  const selectedProcess = processes.find((p) => p.id === processId)

  useEffect(() => {
    const p = launcher?.prefill
    if (p) {
      setMode(p.mode)
      setPersonaId(p.personaId ?? '')
      setPrompt(p.prompt ?? '')
      setTitle(p.title ?? '')
      setCommand(p.command ?? '')
      const dk = p.detKind ?? (p.processId ? 'process' : 'command')
      setDetKind(dk)
      setProcessId(p.processId ?? '')
      setProcessInputs(p.inputs ?? {})
      // Jump straight to the relevant input stage for a re-run.
      setStage(
        p.mode === 'agentic' ? 'agentic-prompt' : dk === 'process' ? 'det-process' : 'det-command'
      )
    } else if (launcher) {
      setMode('agentic')
      setDetKind(processes.length > 0 ? 'process' : 'command')
      setStage('mode')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launcher])

  // Park add-step uses a workflow parent id (not on the main canvas).
  const parent = launcher && !parkId ? nodeById(launcher.parentId) : undefined

  const selectedPersona = personas.find((p) => p.id === personaId)
  const personaProvider = providers.find((v) => v.id === selectedPersona?.providerId)
  const personaReady =
    Boolean(personaProvider) &&
    (personaProvider!.hasKey || personaProvider!.kind === 'openai-compatible')

  // The built-in "Summarize Report" persona is the default Report writer.
  const defaultReportPersona = useMemo(
    () => personas.find((p) => p.builtin === 'summarize-report'),
    [personas]
  )
  // Entering Report mode with no persona chosen pre-selects the built-in writer.
  useEffect(() => {
    if (mode === 'report' && reportWriter === 'persona' && !personaId && defaultReportPersona) {
      setPersonaId(defaultReportPersona.id)
    }
  }, [mode, reportWriter, personaId, defaultReportPersona])

  const reset = () => {
    setMode('agentic')
    setStage('mode')
    setPersonaId('')
    setPrompt('')
    setOutputSpec('')
    setTitle('')
    setCommand('')
    setReportWriter('persona')
    setProcessId('')
    setProcessInputs({})
    setParkName('')
    setParkKind('trigger')
    setBusy(false)
  }

  const onClose = () => {
    reset()
    close()
  }

  // Picking a top-level mode is a fresh authoring intent — clear per-step
  // selections so nothing bleeds across modes, then advance to its first stage.
  const pickMode = (id: Mode) => {
    setMode(id)
    setPersonaId('')
    setPrompt('')
    setOutputSpec('')
    setTitle('')
    setCommand('')
    setReportWriter('persona')
    setProcessId('')
    setProcessInputs({})
    setStage(firstStage[id])
  }

  const pickDetKind = (k: DetKind) => {
    setDetKind(k)
    setProcessId('')
    setProcessInputs({})
    setTitle('')
    setCommand('')
    setOutputSpec('')
    setStage(k === 'process' ? 'det-process' : 'det-command')
  }

  const pickReportWriter = (w: ReportWriter) => {
    setReportWriter(w)
    setPersonaId('')
    setProcessId('')
    setProcessInputs({})
    setPrompt('')
    setStage('report-pick')
  }

  // Adding a workflow step is just a definition edit — runs don't block it.
  const runBlocked = !parkId && anyRunning

  const processReady =
    Boolean(selectedProcess) &&
    (selectedProcess?.inputs ?? []).every(
      (inp) => !inp.required || (processInputs[inp.name] ?? inp.default ?? '').trim()
    )

  const submitProcess = async () => {
    if (!launcher || !selectedProcess || !processReady || runBlocked) return
    setBusy(true)
    try {
      if (parkId) {
        await addWorkflowStep(parkId, {
          parentId: launcher.parentId,
          kind: 'deterministic',
          title: selectedProcess.name,
          processId: selectedProcess.id,
          inputs: processInputs,
          outputSpec: outputSpec.trim() || undefined
        })
      } else {
        await runProcess(launcher.parentId, selectedProcess.id, processInputs)
      }
      onClose()
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false)
    }
  }

  // In a Park every agentic/report step must declare its output.
  const outputReady = !parkId || outputSpec.trim().length > 0

  const submitAgentic = async () => {
    if (!launcher || !personaId || !prompt.trim() || !personaReady || runBlocked) return
    if (parkId && !outputReady) return
    setBusy(true)
    try {
      if (parkId) {
        await addWorkflowStep(parkId, {
          parentId: launcher.parentId,
          kind: 'agentic',
          title: selectedPersona?.name ?? 'Agent',
          personaId,
          prompt: prompt.trim(),
          outputSpec: outputSpec.trim()
        })
      } else {
        await runAgentic(launcher.parentId, personaId, prompt.trim())
      }
      onClose()
    } catch {
      /* toast already shown — keep the modal open */
    } finally {
      setBusy(false)
    }
  }

  // A report is written by either a persona (agentic) or a process (deterministic).
  const reportProcessReady =
    Boolean(selectedProcess) &&
    (selectedProcess?.inputs ?? []).every(
      (inp) => !inp.required || inp.name === 'run_results' || (inp.default ?? '').trim()
    )
  const reportReady =
    reportWriter === 'process' ? reportProcessReady : Boolean(personaId) && personaReady

  const submitReport = async () => {
    if (!launcher || !parkId || !reportReady || runBlocked) return
    setBusy(true)
    try {
      await addWorkflowStep(parkId, {
        parentId: launcher.parentId,
        kind: 'report',
        title: title.trim() || 'Report',
        ...(reportWriter === 'process'
          ? { processId: selectedProcess!.id }
          : { personaId, prompt: prompt.trim() || undefined }),
        outputSpec: 'Report of the whole run'
      })
      onClose()
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false)
    }
  }

  const submitDeterministic = async () => {
    if (!launcher || !command.trim() || runBlocked) return
    setBusy(true)
    try {
      if (parkId) {
        await addWorkflowStep(parkId, {
          parentId: launcher.parentId,
          kind: 'deterministic',
          title: title.trim() || 'Task',
          command: command.trim(),
          outputSpec: outputSpec.trim() || undefined
        })
      } else {
        await runDeterministic(launcher.parentId, title.trim() || 'Task', command.trim())
      }
      onClose()
    } catch {
      /* toast already shown */
    } finally {
      setBusy(false)
    }
  }

  const submitPark = async () => {
    if (!launcher || !parkName.trim()) return
    setBusy(true)
    try {
      const id = await createParkNode(launcher.parentId, parkName.trim(), parkKind)
      onClose()
      if (id) openPark(id)
    } finally {
      setBusy(false)
    }
  }

  const segments = useMemo(() => {
    const base: { id: Mode; label: string; hint: string; icon: React.ReactNode }[] = [
      { id: 'agentic', label: 'Agentic', hint: 'A persona runs a prompt', icon: <Sparkles size={20} /> },
      {
        id: 'deterministic',
        label: 'Deterministic',
        hint: 'A process or shell command',
        icon: <TerminalSquare size={20} />
      }
    ]
    if (parkId)
      base.push({ id: 'report', label: 'Report', hint: 'Summarize the whole run', icon: <FileText size={20} /> })
    else base.push({ id: 'park', label: 'Park', hint: 'A nested workflow', icon: <Workflow size={20} /> })
    return base
  }, [parkId])

  const stepVerb = parkId ? 'Add step' : null

  // ── Breadcrumb trail — each completed decision "ascends" to the top ──
  const trail: { key: string; label: string; onClick: () => void }[] = []
  if (stage !== 'mode') {
    const m = segments.find((s) => s.id === mode)
    trail.push({ key: 'mode', label: m?.label ?? mode, onClick: () => setStage('mode') })
    if (mode === 'agentic' && stage === 'agentic-prompt' && selectedPersona) {
      trail.push({ key: 'persona', label: selectedPersona.name, onClick: () => setStage('agentic-persona') })
    }
    if (mode === 'report' && (stage === 'report-pick' || stage === 'report-writer')) {
      if (stage === 'report-pick')
        trail.push({
          key: 'writer',
          label: reportWriter === 'process' ? 'Process' : 'Persona',
          onClick: () => setStage('report-writer')
        })
    }
    if (mode === 'deterministic' && (stage === 'det-process' || stage === 'det-command')) {
      trail.push({
        key: 'detkind',
        label: detKind === 'process' ? 'Process' : 'Quick command',
        onClick: () => setStage('det-kind')
      })
    }
  }

  const heading = HEADINGS[stage]
  const accent: StageAccent = stage === 'mode' ? 'iris' : MODE_ACCENT[mode]

  return (
    <AgentStage open={Boolean(launcher)} onClose={onClose} accent={accent} labelledBy="launcher-title">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-6 pb-14 pt-24">
        <div className="mx-auto flex w-full max-w-[600px] flex-col items-center">
          {trail.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center justify-center gap-1.5">
              {trail.map((t, i) => (
                <div key={t.key} className="flex animate-chip-pop items-center gap-1.5">
                  {i > 0 && <ChevronRight size={13} className="text-ink-ghost" />}
                  <button
                    onClick={t.onClick}
                    className="no-drag rounded-full border border-white/10 bg-black/50 px-3 py-1 text-xs font-medium text-ink-soft backdrop-blur-md transition-colors hover:border-white/25 hover:text-ink"
                  >
                    {t.label}
                  </button>
                </div>
              ))}
            </div>
          )}

          <h2 id="launcher-title" className="text-center text-xl font-semibold tracking-tight text-ink">
            {stage === 'mode' ? (parkId ? 'Add a workflow step' : 'Build a new step') : heading}
          </h2>
          <p className="mt-1.5 max-w-md text-center text-[12.5px] leading-relaxed text-ink-faint">
            {stage === 'mode'
              ? parkId
                ? 'Runs in order when the workflow is triggered — can see earlier steps’ outputs'
                : `Branches from ${parent?.title ?? 'this node'}’s codebase state · creates a new node`
              : SUBHEADINGS[stage]}
          </p>

          <div key={stage} className="mt-8 w-full animate-float-in">
            {stage === 'mode' && <ModeStage segments={segments} onPick={pickMode} />}

            {stage === 'agentic-persona' && (
              <PersonaGrid
                personas={personas}
                selectedId={personaId}
                onPick={(id) => {
                  setPersonaId(id)
                  setStage('agentic-prompt')
                }}
                emptyCta={() => {
                  onClose()
                  openSettings('personas')
                }}
                emptyLabel="No personas yet — create one in settings"
              />
            )}

            {stage === 'agentic-prompt' && (
              <div className="flex flex-col items-center gap-4">
                {selectedPersona && !personaReady && (
                  <ProviderWarning
                    name={selectedPersona.name}
                    onFix={() => {
                      onClose()
                      openSettings('providers')
                    }}
                  />
                )}
                {parkId && (
                  <FloatingField
                    label="Output — what this step produces"
                    value={outputSpec}
                    onChange={setOutputSpec}
                    className="w-full"
                  />
                )}
                <PromptBox
                  value={prompt}
                  onChange={setPrompt}
                  onSubmit={submitAgentic}
                  placeholder="Describe what this agent should do…"
                  accent="iris"
                  size="hero"
                  autoFocus
                  busy={busy}
                  footer={
                    runBlocked
                      ? 'A run is in progress — wait for it to finish'
                      : parkId && !outputReady
                        ? 'Declare what this step outputs first'
                        : `Enter to ${parkId ? 'add step' : 'run agent'}`
                  }
                />
              </div>
            )}

            {stage === 'report-writer' && (
              <div className="flex flex-col gap-4">
                <p className="rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-faint backdrop-blur-md">
                  A Report step synthesizes a report of the whole run’s outputs (failures and skipped
                  branches included). Choose how it’s written.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <ChoiceCard
                    icon={<Sparkles size={18} />}
                    color="#56d6a0"
                    title="Persona"
                    hint="Agentic — defaults to “Summarize Report”"
                    onClick={() => pickReportWriter('persona')}
                  />
                  <ChoiceCard
                    icon={<SquareTerminal size={18} />}
                    color="#56b6ff"
                    title="Process"
                    hint="A deterministic writer process"
                    onClick={() => pickReportWriter('process')}
                  />
                </div>
              </div>
            )}

            {stage === 'report-pick' && reportWriter === 'persona' && (
              <div className="flex flex-col gap-4">
                <PersonaGrid
                  personas={personas}
                  selectedId={personaId}
                  onPick={setPersonaId}
                  emptyCta={() => {
                    onClose()
                    openSettings('personas')
                  }}
                  emptyLabel="No personas yet — create one in settings"
                />
                {selectedPersona && !personaReady && (
                  <ProviderWarning
                    name={selectedPersona.name}
                    onFix={() => {
                      onClose()
                      openSettings('providers')
                    }}
                  />
                )}
                <FloatingField label="Report title (optional)" value={title} onChange={setTitle} />
                <FloatingField
                  label="Report focus (optional)"
                  value={prompt}
                  onChange={setPrompt}
                  multiline
                  rows={2}
                />
                <ActionRow
                  hint={runBlocked ? 'A run is in progress — wait for it to finish' : undefined}
                  disabled={!reportReady || busy || runBlocked}
                  busy={busy}
                  icon={<FileText size={15} />}
                  label="Add report"
                  onClick={submitReport}
                />
              </div>
            )}

            {stage === 'report-pick' && reportWriter === 'process' && (
              <div className="flex flex-col gap-4">
                <ProcessGrid
                  processes={processes}
                  selectedId={processId}
                  onPick={(p) => {
                    setProcessId(p.id)
                    setProcessInputs(Object.fromEntries(p.inputs.map((i) => [i.name, i.default ?? ''])))
                  }}
                  emptyCta={() => {
                    onClose()
                    openCaretaker()
                  }}
                />
                <p className="text-[11px] leading-relaxed text-ink-ghost">
                  The whole run’s results are passed as{' '}
                  <span className="font-mono text-ink-faint">$XCOM_run_results</span> (and a{' '}
                  <span className="font-mono text-ink-faint">{'{{run_results}}'}</span> input); its
                  stdout becomes the report.
                </p>
                {selectedProcess && !reportProcessReady && (
                  <p className="rounded-lg bg-amber/10 px-3 py-2 text-[11px] text-amber-soft">
                    “{selectedProcess.name}” has a required input the report can’t provide. Pick a
                    process that needs only <span className="font-mono">run_results</span>, or give
                    its other required inputs defaults.
                  </p>
                )}
                <FloatingField label="Report title (optional)" value={title} onChange={setTitle} />
                <ActionRow
                  hint={runBlocked ? 'A run is in progress — wait for it to finish' : undefined}
                  disabled={!reportReady || busy || runBlocked}
                  busy={busy}
                  icon={<FileText size={15} />}
                  label="Add report"
                  onClick={submitReport}
                />
              </div>
            )}

            {stage === 'det-kind' && (
              <div className="grid grid-cols-2 gap-3">
                <ChoiceCard
                  icon={<SquareTerminal size={18} />}
                  color="#56b6ff"
                  title="Process"
                  hint="A saved, reusable process"
                  onClick={() => pickDetKind('process')}
                />
                <ChoiceCard
                  icon={<TerminalSquare size={18} />}
                  color="#ffb454"
                  title="Quick command"
                  hint="A one-off shell command"
                  onClick={() => pickDetKind('command')}
                />
              </div>
            )}

            {stage === 'det-process' && (
              <div className="flex flex-col gap-4">
                <ProcessGrid
                  processes={processes}
                  selectedId={processId}
                  onPick={(p) => {
                    setProcessId(p.id)
                    setProcessInputs(Object.fromEntries(p.inputs.map((i) => [i.name, i.default ?? ''])))
                  }}
                  emptyCta={() => {
                    onClose()
                    openCaretaker()
                  }}
                />
                {selectedProcess && selectedProcess.inputs.length > 0 && (
                  <div className="space-y-3">
                    <span className="block text-xs font-medium uppercase tracking-wide text-ink-faint">
                      Inputs
                    </span>
                    {selectedProcess.inputs.map((inp) => (
                      <div key={inp.name}>
                        <div className="mb-1 flex items-center gap-1.5 text-xs text-ink-soft">
                          <span className="font-mono">{inp.name}</span>
                          {inp.required && <span className="text-rose">*</span>}
                          {inp.description && <span className="text-ink-ghost">— {inp.description}</span>}
                        </div>
                        <input
                          className="no-drag w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 font-mono text-[13px] text-ink outline-none backdrop-blur-md focus:border-iris/55"
                          placeholder={inp.default ?? ''}
                          value={processInputs[inp.name] ?? ''}
                          onChange={(e) => setProcessInputs((x) => ({ ...x, [inp.name]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {parkId && (
                  <FloatingField
                    label="Output (optional — defaults to the command result)"
                    value={outputSpec}
                    onChange={setOutputSpec}
                  />
                )}
                <ActionRow
                  hint={
                    runBlocked
                      ? 'A run is in progress — wait for it to finish'
                      : parkId
                        ? 'Reads the frozen codebase at ./codebase'
                        : 'Runs against the parent step’s code'
                  }
                  disabled={!processReady || busy || runBlocked}
                  busy={busy}
                  icon={parkId ? <Plus size={15} /> : <Play size={15} />}
                  label={stepVerb ?? 'Run process'}
                  onClick={submitProcess}
                />
              </div>
            )}

            {stage === 'det-command' && (
              <div className="flex flex-col gap-4">
                <FloatingField label="Task name" value={title} onChange={setTitle} autoFocus />
                <FloatingField
                  label="Shell command"
                  value={command}
                  onChange={setCommand}
                  multiline
                  mono
                  rows={3}
                  onSubmit={submitDeterministic}
                />
                <p className="text-[11px] leading-relaxed text-ink-ghost">
                  {parkId
                    ? 'Runs in the isolated workspace; the read-only codebase is at ./codebase and $KENNEL_CODEBASE.'
                    : 'Runs in the project root against the parent step’s codebase.'}
                </p>
                {parkId && (
                  <FloatingField
                    label="Output (optional — defaults to the command result)"
                    value={outputSpec}
                    onChange={setOutputSpec}
                  />
                )}
                <ActionRow
                  hint={runBlocked ? 'A run is in progress — wait for it to finish' : '⌘↵ to confirm'}
                  disabled={!command.trim() || busy || runBlocked}
                  busy={busy}
                  icon={parkId ? <Plus size={15} /> : <TerminalSquare size={15} />}
                  label={stepVerb ?? 'Run task'}
                  onClick={submitDeterministic}
                />
              </div>
            )}

            {stage === 'park-form' && (
              <div className="flex flex-col gap-5">
                <FloatingField label="Park name" value={parkName} onChange={setParkName} autoFocus />
                {parkName.trim() && (
                  <div className="animate-float-in">
                    <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-ink-faint">
                      Execution
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <ChoiceCard
                        icon={<Zap size={18} />}
                        color="#56b6ff"
                        title="Trigger"
                        hint="Run on demand"
                        active={parkKind === 'trigger'}
                        onClick={() => setParkKind('trigger')}
                      />
                      <ChoiceCard
                        icon={<Clock size={18} />}
                        color="#7c6cff"
                        title="Schedule"
                        hint="Run on a cron schedule"
                        active={parkKind === 'schedule'}
                        onClick={() => setParkKind('schedule')}
                      />
                    </div>
                  </div>
                )}
                <p className="text-[11px] leading-relaxed text-ink-ghost">
                  A Park opens its own canvas where you (or the Walker) build a workflow. It runs
                  against <span className="text-ink-soft">{parent?.title ?? 'this node'}</span>’s
                  codebase, fresh each run.
                </p>
                <ActionRow
                  disabled={!parkName.trim() || busy}
                  busy={busy}
                  icon={<Workflow size={15} />}
                  label="Create park"
                  onClick={submitPark}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </AgentStage>
  )
}

const HEADINGS: Record<Stage, string> = {
  mode: 'Build a new step',
  'agentic-persona': 'Choose a persona',
  'agentic-prompt': 'Write the prompt',
  'report-writer': 'How is the report written?',
  'report-pick': 'Report writer',
  'det-kind': 'Deterministic step',
  'det-process': 'Choose a process',
  'det-command': 'Quick command',
  'park-form': 'New Park'
}
const SUBHEADINGS: Record<Stage, string> = {
  mode: '',
  'agentic-persona': 'An agent persona will run your prompt against the codebase.',
  'agentic-prompt': 'Tell the agent exactly what to do.',
  'report-writer': '',
  'report-pick': 'Pick who writes the run’s report.',
  'det-kind': 'Run a saved process, or a one-off shell command.',
  'det-process': 'A reusable, version-tracked process.',
  'det-command': 'A one-off shell command for this step.',
  'park-form': 'A nested, triggerable or scheduled workflow.'
}

function ModeStage({
  segments,
  onPick
}: {
  segments: { id: Mode; label: string; hint: string; icon: React.ReactNode }[]
  onPick: (id: Mode) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {segments.map((s) => (
        <button
          key={s.id}
          onClick={() => onPick(s.id)}
          className="no-drag group flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/50 px-3 py-6 text-center backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white/25"
          style={{ ['--c' as string]: MODE_COLOR[s.id] }}
        >
          <span
            className="flex h-12 w-12 items-center justify-center rounded-2xl transition-transform group-hover:scale-110"
            style={{
              background: `${MODE_COLOR[s.id]}1f`,
              boxShadow: `inset 0 0 0 1px ${MODE_COLOR[s.id]}55`,
              color: MODE_COLOR[s.id]
            }}
          >
            {s.icon}
          </span>
          <span className="text-sm font-semibold text-ink">{s.label}</span>
          <span className="text-[11px] leading-tight text-ink-faint">{s.hint}</span>
        </button>
      ))}
    </div>
  )
}

function ChoiceCard({
  icon,
  color,
  title,
  hint,
  active,
  onClick
}: {
  icon: React.ReactNode
  color: string
  title: string
  hint: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'no-drag flex flex-col gap-2 rounded-2xl border bg-black/50 p-4 text-left backdrop-blur-md transition-all hover:-translate-y-0.5',
        active ? 'border-transparent ring-2' : 'border-white/10 hover:border-white/25'
      )}
      style={active ? ({ '--tw-ring-color': color } as React.CSSProperties) : undefined}
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}55`, color }}
      >
        {icon}
      </span>
      <span className="text-sm font-semibold text-ink">{title}</span>
      <span className="text-[11px] leading-tight text-ink-faint">{hint}</span>
    </button>
  )
}

function PersonaGrid({
  personas,
  selectedId,
  onPick,
  emptyCta,
  emptyLabel
}: {
  personas: import('@shared/types').AgentPersona[]
  selectedId: string
  onPick: (id: string) => void
  emptyCta: () => void
  emptyLabel: string
}) {
  if (personas.length === 0) {
    return (
      <button
        onClick={emptyCta}
        className="no-drag w-full rounded-2xl border border-dashed border-white/15 py-8 text-sm text-ink-faint hover:border-white/30"
      >
        {emptyLabel}
      </button>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {personas.map((p) => {
        const sel = p.id === selectedId
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            className={clsx(
              'no-drag flex items-center gap-2.5 rounded-2xl border bg-black/50 p-2.5 text-left backdrop-blur-md transition-all',
              sel ? 'border-transparent ring-2' : 'border-white/10 hover:border-white/25'
            )}
            style={sel ? ({ '--tw-ring-color': p.color } as React.CSSProperties) : undefined}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base"
              style={{ background: `${p.color}22`, boxShadow: `inset 0 0 0 1px ${p.color}55` }}
            >
              {p.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                {p.builtin === 'summarize-report' && (
                  <span className="shrink-0 rounded bg-mint/12 px-1 py-0.5 text-[8.5px] font-medium uppercase tracking-wide text-mint">
                    default
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-ink-ghost">
                {p.permissions.canEditFiles && <FilePen size={10} />}
                {p.permissions.canRunBash && <TerminalSquare size={10} />}
                {p.permissions.canEditCoreMemory && <BrainCircuit size={10} />}
                {p.permissions.canSearchWeb && <Globe size={10} />}
                {p.permissions.canUseMcp && <Plug size={10} />}
                <span className="truncate">{p.model}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ProcessGrid({
  processes,
  selectedId,
  onPick,
  emptyCta
}: {
  processes: import('@shared/types').DeterministicProcess[]
  selectedId: string
  onPick: (p: import('@shared/types').DeterministicProcess) => void
  emptyCta: () => void
}) {
  if (processes.length === 0) {
    return (
      <button
        onClick={emptyCta}
        className="no-drag w-full rounded-2xl border border-dashed border-white/15 py-8 text-sm text-ink-faint hover:border-white/30"
      >
        No processes yet — ask the Care Taker to create one
      </button>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {processes.map((p) => {
        const sel = p.id === selectedId
        return (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className={clsx(
              'no-drag flex items-center gap-2.5 rounded-2xl border bg-black/50 p-2.5 text-left backdrop-blur-md transition-all',
              sel ? 'border-transparent ring-2' : 'border-white/10 hover:border-white/25'
            )}
            style={sel ? ({ '--tw-ring-color': p.color } as React.CSSProperties) : undefined}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base"
              style={{ background: `${p.color}22`, boxShadow: `inset 0 0 0 1px ${p.color}55` }}
            >
              {p.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
              <span className="block truncate font-mono text-[10px] text-ink-ghost">$ {p.command}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ProviderWarning({ name, onFix }: { name: string; onFix: () => void }) {
  return (
    <button
      onClick={onFix}
      className="no-drag flex w-full items-center gap-2 rounded-xl bg-amber/10 px-3 py-2 text-xs text-amber-soft"
    >
      <KeyRound size={13} />
      {name}’s provider needs an API key — configure it
    </button>
  )
}

function ActionRow({
  hint,
  disabled,
  busy,
  icon,
  label,
  onClick
}: {
  hint?: string
  disabled: boolean
  busy: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-ink-ghost">{hint}</span>
      <Button variant="primary" disabled={disabled} onClick={onClick}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
        {label}
      </Button>
    </div>
  )
}
