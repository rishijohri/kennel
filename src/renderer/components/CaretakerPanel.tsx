import { useMemo, useState } from 'react'
import { useKennel } from '../store/useKennel'
import { AgentChatStage } from './agent/AgentChatStage'
import { AgentConfigRow } from './agent/AgentConfigRow'
import { caretakerIcon } from '../assets/icons'

export function CaretakerPanel() {
  const open = useKennel((s) => s.caretakerOpen)
  const close = useKennel((s) => s.closeCaretaker)
  const providers = useKennel((s) => s.state?.providers ?? [])
  const caretaker = useKennel((s) => s.state?.caretaker ?? null)
  const saveCaretaker = useKennel((s) => s.saveCaretaker)
  const chats = useKennel((s) => s.state?.caretakerChats ?? [])
  const activeChatId = useKennel((s) => s.caretakerActiveChatId)
  const runningChatId = useKennel((s) => s.caretakerRunningChatId)
  const stream = useKennel((s) => s.caretakerStream)
  const send = useKennel((s) => s.sendCaretaker)
  const cancel = useKennel((s) => s.cancelCaretaker)
  const selectChat = useKennel((s) => s.selectCaretakerChat)
  const newChat = useKennel((s) => s.newCaretakerChat)
  const deleteChat = useKennel((s) => s.deleteCaretakerChat)
  const openSettings = useKennel((s) => s.openSettings)

  const [input, setInput] = useState('')

  const provider = providers.find((p) => p.id === caretaker?.providerId)
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
    ? `${provider!.name} · ${caretaker?.model || provider!.defaultModel || 'model'}`
    : 'Set up agents & deterministic processes'

  return (
    <AgentChatStage
      open={open}
      onClose={close}
      icon={caretakerIcon}
      name="Care Taker"
      tagline={tagline}
      accent="iris"
      labelledBy="ct-title"
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
      placeholder="Tell the Care Taker what to set up…"
      notConfiguredLabel="Connect the Care Taker to a provider to begin"
      configSlot={
        <AgentConfigRow
          providers={providers}
          config={caretaker}
          onSave={saveCaretaker}
          onAddProvider={() => {
            close()
            openSettings('providers')
          }}
        />
      }
      emptyHint={
        <>
          Ask the Care Taker to create agent personas or deterministic processes. Try{' '}
          <span className="text-ink-soft">“Make a reviewer persona”</span> or{' '}
          <span className="text-ink-soft">“Add a process that runs the test suite”</span>.
        </>
      }
    />
  )
}
