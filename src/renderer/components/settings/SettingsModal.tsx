import { clsx } from 'clsx'
import { Server, Users, Cpu, Plug } from 'lucide-react'
import { useKennel } from '../../store/useKennel'
import { Modal, ModalHeader } from '../ui'
import { ProvidersPanel } from './ProvidersPanel'
import { PersonasPanel } from './PersonasPanel'
import { LocalModelsPanel } from './LocalModelsPanel'
import { McpPanel } from './McpPanel'

export function SettingsModal() {
  const open = useKennel((s) => s.settingsOpen)
  const tab = useKennel((s) => s.settingsTab)
  const close = useKennel((s) => s.closeSettings)
  const openSettings = useKennel((s) => s.openSettings)

  return (
    <Modal open={open} onClose={close} className="flex h-[82vh] max-w-3xl flex-col" labelledBy="settings-title">
      <ModalHeader
        id="settings-title"
        title="Settings"
        subtitle="Connect AI providers and design your agent personas"
        onClose={close}
      />

      <div className="flex gap-1 border-b border-line px-4 pt-2">
        <TabButton active={tab === 'providers'} onClick={() => openSettings('providers')}>
          <Server size={15} />
          Providers
        </TabButton>
        <TabButton active={tab === 'local'} onClick={() => openSettings('local')}>
          <Cpu size={15} />
          Local Models
        </TabButton>
        <TabButton active={tab === 'mcp'} onClick={() => openSettings('mcp')}>
          <Plug size={15} />
          MCP
        </TabButton>
        <TabButton active={tab === 'personas'} onClick={() => openSettings('personas')}>
          <Users size={15} />
          Personas
        </TabButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'providers' && <ProvidersPanel />}
        {tab === 'local' && <LocalModelsPanel />}
        {tab === 'mcp' && <McpPanel />}
        {tab === 'personas' && <PersonasPanel />}
      </div>
    </Modal>
  )
}

function TabButton({
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
        'no-drag flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1.5 text-sm font-medium transition-colors',
        active ? 'border-iris text-ink' : 'border-transparent text-ink-faint hover:text-ink-soft'
      )}
    >
      {children}
    </button>
  )
}
