import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { RefreshCw, Loader2 } from 'lucide-react'
import type { ProviderKind } from '@shared/types'
import { useKennel } from '../store/useKennel'
import { Button, Select, TextInput } from './ui'

/** A small curated fallback so the dropdown isn't empty before a provider has
 *  been tested. The live, fetched list always takes precedence. */
const KNOWN_MODELS: Partial<Record<ProviderKind, string[]>> = {
  anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-fable-5'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  'google-vertex': ['gemini-2.5-pro', 'gemini-2.5-flash']
}

const CUSTOM = '__custom__'

/**
 * Model picker: a dropdown sourced from the provider's fetched models (cached on
 * the provider after a successful test), with a curated fallback, a "load models"
 * button that fetches them from the endpoint, and a "Custom…" escape hatch for
 * ids not in any list (e.g. a self-hosted model).
 */
export function ModelSelect({
  providerId,
  value,
  onChange,
  className
}: {
  providerId: string
  value: string
  onChange: (model: string) => void
  className?: string
}) {
  const providers = useKennel((s) => s.state?.providers ?? [])
  const pushToast = useKennel((s) => s.pushToast)
  const provider = providers.find((p) => p.id === providerId)
  const [loading, setLoading] = useState(false)
  const [custom, setCustom] = useState(false)

  const options = useMemo(() => {
    const base = provider?.models?.length
      ? provider.models
      : (KNOWN_MODELS[provider?.kind as ProviderKind] ?? [])
    const out: string[] = []
    for (const m of [...(value ? [value] : []), ...base]) if (m && !out.includes(m)) out.push(m)
    return out
  }, [provider?.models, provider?.kind, value])

  // Never sit on an empty selection when options are available.
  useEffect(() => {
    if (!custom && !value && options.length) onChange(options[0])
  }, [custom, value, options, onChange])

  const load = async () => {
    if (!provider) return
    setLoading(true)
    try {
      const res = await window.kennel.testProvider(provider.id)
      if (!res.ok) pushToast('error', res.message || 'Could not load models')
      else if (!res.models?.length) pushToast('info', 'Connected, but the provider returned no models.')
      else if (!value) onChange(res.models[0])
    } finally {
      setLoading(false)
    }
  }

  // No provider selected yet — fall back to a plain text field.
  if (!provider) {
    return (
      <TextInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="model id"
        className={clsx('font-mono text-[13px]', className)}
      />
    )
  }

  if (custom) {
    return (
      <div className={clsx('flex gap-2', className)}>
        <TextInput
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="model id"
          className="min-w-0 flex-1 font-mono text-[13px]"
        />
        <Button variant="subtle" onClick={() => setCustom(false)} className="shrink-0 text-xs">
          List
        </Button>
      </div>
    )
  }

  return (
    <div className={clsx('flex gap-2', className)}>
      <Select
        value={options.includes(value) ? value : ''}
        onChange={(e) => (e.target.value === CUSTOM ? setCustom(true) : onChange(e.target.value))}
        className="min-w-0 flex-1 font-mono text-[13px]"
      >
        {options.length === 0 && (
          <option value="">{loading ? 'Loading…' : 'No models — load them →'}</option>
        )}
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value={CUSTOM}>Custom model…</option>
      </Select>
      <Button
        variant="subtle"
        onClick={load}
        disabled={loading}
        className="shrink-0 px-2.5"
        title="Fetch the latest models from the provider"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      </Button>
    </div>
  )
}
