import { useEffect, useState } from 'react'
import { Select } from '../ui'
import { ModelSelect } from '../ModelSelect'

/**
 * Provider + model picker shared by the Walker and Care Taker stages. Binds a
 * default on first connect but never re-saves an unchanged config.
 */
export function AgentConfigRow({
  providers,
  config,
  onSave,
  onAddProvider
}: {
  providers: { id: string; name: string; defaultModel?: string }[]
  config: { providerId: string; model: string } | null
  onSave: (c: { providerId: string; model: string } | null) => void
  onAddProvider: () => void
}) {
  // Coerce a saved provider that's no longer offered here (e.g. a Copilot
  // provider, which can't orchestrate the Walker/Care Taker) to the first valid
  // one, so the picker is never stuck on an unselectable value.
  const initialId = providers.find((p) => p.id === config?.providerId)?.id || providers[0]?.id || ''
  const [providerId, setProviderId] = useState(initialId)
  const [model, setModel] = useState(
    (initialId === config?.providerId ? config?.model : '') ||
      providers.find((p) => p.id === initialId)?.defaultModel ||
      ''
  )

  useEffect(() => {
    if (providerId && model && (providerId !== config?.providerId || model !== config?.model)) {
      onSave({ providerId, model })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, model])

  if (providers.length === 0) {
    return (
      <button onClick={onAddProvider} className="no-drag text-xs text-amber-soft hover:text-amber">
        No providers yet — add one in settings first →
      </button>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-faint">Provider</span>
        <Select
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value)
            setModel(providers.find((p) => p.id === e.target.value)?.defaultModel ?? '')
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-faint">Model</span>
        <ModelSelect providerId={providerId} value={model} onChange={setModel} />
      </div>
    </div>
  )
}
