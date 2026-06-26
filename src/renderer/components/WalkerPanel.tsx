import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ShieldCheck, Scale, Rocket, Workflow } from 'lucide-react'
import { useKennel } from '../store/useKennel'
import { AgentChatStage } from './agent/AgentChatStage'
import { AgentConfigRow } from './agent/AgentConfigRow'
import { walkerIcon } from '../assets/icons'
import type { WalkerAutonomy } from '@shared/types'

const AUTONOMY: {
  value: WalkerAutonomy
  label: string
  hint: string
  icon: typeof ShieldCheck
}[] = [
  { value: 'low', label: 'Cautious', hint: 'Up to 3 nodes · existing tools only', icon: ShieldCheck },
  { value: 'medium', label: 'Balanced', hint: 'Up to 8 nodes · may use Care Taker', icon: Scale },
  { value: 'high', label: 'Autonomous', hint: 'Up to 25 nodes · free experimentation', icon: Rocket }
]

export function WalkerPanel() {
  const open = useKennel((s) => s.walkerOpen)
  const close = useKennel((s) => s.closeWalker)
  const providers = useKennel((s) => s.state?.providers ?? [])
  const walker = useKennel((s) => s.state?.walker ?? null)
  const saveWalker = useKennel((s) => s.saveWalker)
  const chats = useKennel((s) => s.state?.walkerChats ?? [])
  const activeChatId = useKennel((s) => s.walkerActiveChatId)
  const runningChatId = useKennel((s) => s.walkerRunningChatId)
  const stream = useKennel((s) => s.walkerStream)
  const send = useKennel((s) => s.sendWalker)
  const cancel = useKennel((s) => s.cancelWalker)
  const autonomy = useKennel((s) => s.walkerAutonomy)
  const setAutonomy = useKennel((s) => s.setWalkerAutonomy)
  const selectChat = useKennel((s) => s.selectWalkerChat)
  const newChat = useKennel((s) => s.newWalkerChat)
  const deleteChat = useKennel((s) => s.deleteWalkerChat)
  const openSettings = useKennel((s) => s.openSettings)
  // When a Park is open, the Walker builds & runs THAT Park's workflow.
  const openParkId = useKennel((s) => s.openParkId)
  const parks = useKennel((s) => s.state?.parks ?? [])
  const parkName = openParkId ? (parks.find((p) => p.id === openParkId)?.name ?? null) : null

  const [input, setInput] = useState('')

  const provider = providers.find((p) => p.id === walker?.providerId)
  const configured = Boolean(provider)

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId) ?? null, [chats, activeChatId])
  const messages = activeChat?.messages ?? []
  const busyHere = runningChatId !== null && runningChatId === activeChatId
  const busyElsewhere = runningChatId !== null && runningChatId !== activeChatId

  const submit = () => {
    if (!input.trim() || runningChatId !== null || !configured) return
    void send(input.trim())
    setInput('')
  }

  const tagline = configured
    ? `${provider!.name} · ${walker?.model || provider!.defaultModel || 'model'}`
    : 'Autonomous canvas orchestrator'

  return (
    <AgentChatStage
      open={open}
      onClose={close}
      icon={walkerIcon}
      name="Walker"
      tagline={tagline}
      accent="mint"
      labelledBy="wk-title"
      configured={configured}
      history={{
        chats,
        activeChatId,
        runningChatId,
        onSelect: selectChat,
        onNew: () => void newChat(),
        onDelete: (id) => void deleteChat(id)
      }}
      messages={messages}
      stream={stream}
      busyHere={busyHere}
      busyElsewhere={busyElsewhere}
      input={input}
      onInput={setInput}
      onSend={submit}
      onCancel={cancel}
      onOpenRunning={() => runningChatId && selectChat(runningChatId)}
      placeholder={
        openParkId && parkName ? `Describe the task for the ${parkName} Park…` : 'Describe the task for the Walker…'
      }
      notConfiguredLabel="Connect the Walker to a provider to begin"
      configSlot={
        <AgentConfigRow
          providers={providers}
          config={walker}
          onSave={saveWalker}
          onAddProvider={() => {
            close()
            openSettings('providers')
          }}
        />
      }
      composerExtras={!busyElsewhere ? <AutonomyPicker value={autonomy} onChange={setAutonomy} disabled={busyHere} /> : undefined}
      banner={
        openParkId && parkName ? (
          <div className="flex items-center gap-2 rounded-xl border border-mint/25 bg-mint/[0.08] px-3.5 py-2 text-xs text-mint">
            <Workflow size={13} className="shrink-0" />
            <span>
              Building Park <span className="font-semibold text-mint-soft">{parkName}</span> — the
              Walker adds &amp; runs steps in this workflow, not the main canvas.
            </span>
          </div>
        ) : undefined
      }
      emptyHint={
        openParkId && parkName ? (
          <>
            It builds the workflow’s steps (personas + processes), runs the whole Park, and iterates
            until it works. Try{' '}
            <span className="text-ink-soft">“Build a nightly workflow that lints, tests, and reports failures”</span>.
          </>
        ) : (
          <>
            It spawns nodes on the canvas, reads their outputs and diffs, and branches to experiment
            until it reaches a verified answer. Try{' '}
            <span className="text-ink-soft">“Add input validation to the API and prove it with tests”</span>.
          </>
        )
      }
    />
  )
}

function AutonomyPicker({
  value,
  onChange,
  disabled
}: {
  value: WalkerAutonomy
  onChange: (a: WalkerAutonomy) => void
  disabled: boolean
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {AUTONOMY.map((a) => {
        const Icon = a.icon
        const active = a.value === value
        return (
          <button
            key={a.value}
            disabled={disabled}
            onClick={() => onChange(a.value)}
            title={a.hint}
            className={clsx(
              'no-drag flex flex-col items-start gap-0.5 rounded-xl border px-2.5 py-2 text-left backdrop-blur-md transition-colors disabled:opacity-50',
              active ? 'border-mint/50 bg-mint/12' : 'border-white/10 bg-black/40 hover:border-white/20'
            )}
          >
            <span className="flex items-center gap-1.5">
              <Icon size={13} className={active ? 'text-mint' : 'text-ink-faint'} />
              <span className={clsx('text-xs font-semibold', active ? 'text-ink' : 'text-ink-soft')}>
                {a.label}
              </span>
            </span>
            <span className="text-[10px] leading-tight text-ink-faint">{a.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
