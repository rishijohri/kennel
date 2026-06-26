import { useEffect } from 'react'
import { useKennel } from './store/useKennel'
import { TitleBar } from './components/TitleBar'
import { Welcome } from './components/Welcome'
import { Sidebar } from './components/Sidebar'
import { FlowCanvas } from './components/canvas/FlowCanvas'
import { ParkCanvas } from './components/park/ParkCanvas'
import { NodeInspector } from './components/inspector/NodeInspector'
import { RunLauncher } from './components/RunLauncher'
import { SettingsModal } from './components/settings/SettingsModal'
import { LocalSetupModal } from './components/settings/LocalSetupModal'
import { CaretakerPanel } from './components/CaretakerPanel'
import { WalkerPanel } from './components/WalkerPanel'
import { Toasts } from './components/Toasts'
import { Spinner } from './components/ui'

export default function App() {
  const ready = useKennel((s) => s.ready)
  const project = useKennel((s) => s.state?.project ?? null)
  const selectedNodeId = useKennel((s) => s.selectedNodeId)
  const openParkId = useKennel((s) => s.openParkId)
  const openPark = useKennel((s) => (s.openParkId ? (s.state?.parks.find((p) => p.id === s.openParkId) ?? null) : null))
  const init = useKennel((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />

      {!ready ? (
        <div className="flex flex-1 items-center justify-center text-ink-faint">
          <Spinner size={20} />
        </div>
      ) : !project ? (
        <Welcome />
      ) : (
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          {openParkId && openPark ? (
            <ParkCanvas park={openPark} />
          ) : (
            <>
              <div className="relative min-w-0 flex-1">
                <FlowCanvas />
              </div>
              {selectedNodeId && <NodeInspector key={selectedNodeId} />}
            </>
          )}
        </div>
      )}

      <RunLauncher />
      <SettingsModal />
      <LocalSetupModal />
      <CaretakerPanel />
      <WalkerPanel />
      <Toasts />
    </div>
  )
}
