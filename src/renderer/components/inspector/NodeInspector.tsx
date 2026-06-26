import { useState } from 'react'
import { clsx } from 'clsx'
import {
  GitBranchPlus,
  GitCommitHorizontal,
  Trash2,
  Check,
  Activity,
  FileText,
  GitCompare,
  Info,
  AlertTriangle,
  RotateCcw
} from 'lucide-react'
import { useKennel } from '../../store/useKennel'
import { Button, Spinner } from '../ui'
import { LogView } from './LogView'
import { FileBrowser } from './FileBrowser'
import { ChangesView } from './ChangesView'

type Tab = 'overview' | 'log' | 'files' | 'changes'

export function NodeInspector() {
  const selectedNodeId = useKennel((s) => s.selectedNodeId)
  const node = useKennel((s) => s.state?.nodes.find((n) => n.id === selectedNodeId))
  const persona = useKennel((s) =>
    s.state?.personas.find((p) => p.id === node?.personaId)
  )
  const activeId = useKennel((s) => s.state?.project?.activeNodeId)
  const running = useKennel((s) => s.running)
  const checkoutNode = useKennel((s) => s.checkoutNode)
  const openLauncher = useKennel((s) => s.openLauncher)
  const deleteNode = useKennel((s) => s.deleteNode)
  const selectNode = useKennel((s) => s.selectNode)

  const isRunning = node ? Boolean(running[node.id]) || node.status === 'running' : false
  const anyRunning = Object.keys(running).length > 0
  const [tab, setTab] = useState<Tab>(isRunning ? 'log' : 'overview')

  if (!node) return null
  const isActive = node.id === activeId

  const retry = () => {
    if (!node.parentId) return
    if (node.kind === 'deterministic' && node.processId) {
      openLauncher(node.parentId, {
        mode: 'deterministic',
        detKind: 'process',
        processId: node.processId,
        inputs: node.inputs
      })
      return
    }
    openLauncher(node.parentId, {
      mode: node.kind === 'deterministic' ? 'deterministic' : 'agentic',
      detKind: 'command',
      personaId: node.personaId,
      prompt: node.prompt,
      title: node.kind === 'deterministic' ? node.title : undefined,
      command: node.command
    })
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Info size={14} /> },
    { id: 'log', label: 'Activity', icon: <Activity size={14} /> },
    { id: 'files', label: 'Files', icon: <FileText size={14} /> },
    { id: 'changes', label: 'Changes', icon: <GitCompare size={14} /> }
  ]

  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l border-line/70 bg-surface/50">
      {/* Header */}
      <div className="border-b border-line/70 px-5 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
            style={{
              background: `${persona?.color ?? '#7c6cff'}1f`,
              boxShadow: `inset 0 0 0 1px ${persona?.color ?? '#7c6cff'}44`
            }}
          >
            {node.kind === 'agentic' ? persona?.emoji ?? '✨' : node.kind === 'deterministic' ? '⚙️' : '📦'}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold text-ink">{node.title}</h2>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
              <GitCommitHorizontal size={12} />
              <span className="font-mono">{node.commit.slice(0, 9)}</span>
              {isRunning && (
                <span className="inline-flex items-center gap-1 text-iris-soft">
                  <Spinner size={9} /> running
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant={isActive ? 'subtle' : 'primary'}
            disabled={isActive || anyRunning}
            onClick={() => checkoutNode(node.id)}
            className="px-3 py-1.5 text-xs"
            title={anyRunning ? 'Cannot switch while a run is in progress' : undefined}
          >
            <Check size={13} />
            {isActive ? 'Checked out' : 'Switch to this state'}
          </Button>
          <Button
            variant="subtle"
            onClick={() => openLauncher(node.id)}
            className="px-3 py-1.5 text-xs"
          >
            <GitBranchPlus size={13} />
            New step
          </Button>
          {node.kind !== 'root' && node.parentId && (
            <Button
              variant="ghost"
              onClick={retry}
              className="px-3 py-1.5 text-xs"
              title="Re-run from the parent state with the same inputs"
            >
              <RotateCcw size={13} />
              Retry
            </Button>
          )}
          {node.kind !== 'root' && (
            <Button
              variant="ghost"
              onClick={() => {
                void deleteNode(node.id)
                selectNode(null)
              }}
              className="px-2.5 py-1.5 text-xs text-ink-faint hover:text-rose"
              title="Delete this node and its descendants"
            >
              <Trash2 size={13} />
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line/70 px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'no-drag flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-xs font-medium transition-colors',
              tab === t.id
                ? 'border-iris text-ink'
                : 'border-transparent text-ink-faint hover:text-ink-soft'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'overview' && <Overview />}
        {tab === 'log' && <LogView nodeId={node.id} isRunning={isRunning} />}
        {tab === 'files' && <FileBrowser nodeId={node.id} />}
        {tab === 'changes' && <ChangesView nodeId={node.id} isRoot={node.kind === 'root'} />}
      </div>
    </aside>
  )
}

function Overview() {
  const selectedNodeId = useKennel((s) => s.selectedNodeId)
  const node = useKennel((s) => s.state?.nodes.find((n) => n.id === selectedNodeId))
  const persona = useKennel((s) => s.state?.personas.find((p) => p.id === node?.personaId))
  if (!node) return null

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      {node.error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose/30 bg-rose/10 p-3 text-xs text-rose-soft">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="selectable">{node.error}</span>
        </div>
      )}

      <Row label="Type">
        <span className="capitalize text-ink">{node.kind === 'root' ? 'Codebase' : node.kind}</span>
      </Row>

      {persona && (
        <Row label="Persona">
          <span className="flex items-center gap-1.5">
            <span>{persona.emoji}</span>
            <span className="text-ink">{persona.name}</span>
            <span className="text-ink-faint">· {persona.model}</span>
          </span>
        </Row>
      )}

      {node.prompt && (
        <Block label="Prompt">
          <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">
            {node.prompt}
          </p>
        </Block>
      )}

      {node.instructions && (
        <Block label="Instructions for descendants">
          <div className="rounded-lg border border-iris/25 bg-iris/[0.07] p-2.5">
            <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed text-iris-soft">
              {node.instructions}
            </p>
          </div>
        </Block>
      )}

      {node.command && (
        <Block label="Command">
          <code className="selectable block whitespace-pre-wrap font-mono text-[12.5px] text-amber-soft">
            $ {node.command}
          </code>
        </Block>
      )}

      {node.inputs && Object.keys(node.inputs).length > 0 && (
        <Block label="Inputs">
          <div className="space-y-1">
            {Object.entries(node.inputs).map(([k, v]) => (
              <div key={k} className="flex gap-2 font-mono text-[12.5px]">
                <span className="text-ink-faint">{k}</span>
                <span className="selectable text-ink-soft">{v || '—'}</span>
              </div>
            ))}
          </div>
        </Block>
      )}

      {node.resultState && (
        <Row label="Result state">
          <span
            className={
              'rounded-full px-2 py-0.5 text-xs font-medium ' +
              (node.resultStateKind === 'success'
                ? 'bg-mint/12 text-mint'
                : node.resultStateKind === 'failure'
                  ? 'bg-rose/15 text-rose'
                  : 'bg-amber/12 text-amber-soft')
            }
          >
            {node.resultState}
          </span>
        </Row>
      )}

      {node.summary && (
        <Block label="Summary">
          <p className="selectable text-[13px] leading-relaxed text-ink-soft">{node.summary}</p>
        </Block>
      )}

      {node.diffStat && (
        <Row label="Changes">
          {node.diffStat.filesChanged > 0 ? (
            <span className="flex items-center gap-2.5 text-[13px]">
              <span className="text-ink">
                {node.diffStat.filesChanged} file{node.diffStat.filesChanged === 1 ? '' : 's'}
              </span>
              <span className="text-mint">+{node.diffStat.insertions}</span>
              <span className="text-rose">−{node.diffStat.deletions}</span>
            </span>
          ) : (
            <span className="text-ink-faint">No file changes</span>
          )}
        </Row>
      )}

      <Row label="Created">
        <span className="text-ink-soft">{new Date(node.createdAt).toLocaleString()}</span>
      </Row>
      <Row label="Commit">
        <span className="font-mono text-ink-soft">{node.commit.slice(0, 12)}</span>
      </Row>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/40 pb-3 text-[13px]">
      <span className="text-ink-faint">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className="rounded-xl border border-line bg-surface/70 p-3">{children}</div>
    </div>
  )
}
