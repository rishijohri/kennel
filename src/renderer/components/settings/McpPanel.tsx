import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Plus, Trash2, Pencil, Plug, TerminalSquare, Globe, Loader2, CheckCircle2, AlertTriangle, X, LibraryBig } from 'lucide-react'
import type { McpServerConfig, McpTransport } from '@shared/types'
import { useKennel } from '../../store/useKennel'
import { Button, Label, Select, TextArea, TextInput, Toggle } from '../ui'

type View = { mode: 'list' } | { mode: 'edit'; id: string | 'new' } | { mode: 'library' }

function parseKV(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}
function kvToText(obj?: Record<string, string>): string {
  return Object.entries(obj ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

export function McpPanel() {
  const servers = useKennel((s) => s.state?.mcpServers ?? [])
  const library = useKennel((s) => s.state?.mcpLibrary ?? [])
  const removeFromProject = useKennel((s) => s.removeMcpServerFromProject)
  const addToProject = useKennel((s) => s.addMcpServerToProject)
  const deleteFromLibrary = useKennel((s) => s.deleteMcpServerFromLibrary)
  const saveMcpServer = useKennel((s) => s.saveMcpServer)
  const [view, setView] = useState<View>({ mode: 'list' })

  if (view.mode === 'edit') {
    const initial = view.id === 'new' ? undefined : library.find((m) => m.id === view.id)
    return <McpForm initial={initial} onDone={() => setView({ mode: 'list' })} />
  }

  if (view.mode === 'library') {
    return (
      <McpLibraryPicker
        library={library}
        inProject={new Set(servers.map((m) => m.id))}
        onAdd={(id) => void addToProject(id)}
        onDelete={(id) => void deleteFromLibrary(id)}
        onBack={() => setView({ mode: 'list' })}
      />
    )
  }

  const available = library.filter((m) => !servers.some((q) => q.id === m.id)).length

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface/50 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-iris/12 text-iris-soft">
          <Plug size={17} />
        </div>
        <div className="text-sm text-ink-soft">
          Connect <span className="text-ink">MCP servers</span> (Model Context Protocol) to give
          your agents extra tools. Personas with the{' '}
          <span className="text-ink">MCP access</span> permission can call tools from every enabled
          server <span className="text-ink">in this project</span>.
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">
          {servers.length} server{servers.length === 1 ? '' : 's'} in this project
        </p>
        <div className="flex items-center gap-1.5">
          <Button variant="subtle" onClick={() => setView({ mode: 'library' })} className="text-xs">
            <LibraryBig size={14} />
            Add existing{available > 0 ? ` (${available})` : ''}
          </Button>
          <Button variant="primary" onClick={() => setView({ mode: 'edit', id: 'new' })} className="text-xs">
            <Plus size={15} />
            Add MCP server
          </Button>
        </div>
      </div>

      {servers.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-ink-ghost">
          No MCP servers in this project. Add a new one, or add an existing one from the store.
        </p>
      )}

      {servers.map((m) => (
        <div key={m.id} className="rounded-2xl border border-line bg-surface/60 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-overlay text-ink-soft">
              {m.transport === 'stdio' ? <TerminalSquare size={17} /> : <Globe size={17} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">{m.name}</span>
                <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
                  {m.transport}
                </span>
                {!m.enabled && (
                  <span className="rounded-full bg-amber/12 px-2 py-0.5 text-[10px] text-amber-soft">
                    disabled
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ink-ghost">
                {m.transport === 'stdio'
                  ? `${m.command ?? ''} ${(m.args ?? []).join(' ')}`.trim()
                  : m.url}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => void saveMcpServer({ ...m, enabled: !m.enabled })}
                title={m.enabled ? 'Disable' : 'Enable'}
                className={clsx(
                  'no-drag relative h-6 w-11 shrink-0 rounded-full transition-colors',
                  m.enabled ? '' : 'bg-line-strong'
                )}
                style={m.enabled ? { background: '#7c6cff' } : undefined}
              >
                <span
                  className={clsx(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                    m.enabled ? 'left-[22px]' : 'left-0.5'
                  )}
                />
              </button>
              <Button variant="ghost" className="px-2 py-1.5" onClick={() => setView({ mode: 'edit', id: m.id })}>
                <Pencil size={13} />
              </Button>
              <Button
                variant="ghost"
                className="px-2 py-1.5 text-ink-faint hover:text-rose"
                title="Remove from this project (keeps it in the store)"
                onClick={() => void removeFromProject(m.id)}
              >
                <X size={14} />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function McpLibraryPicker({
  library,
  inProject,
  onAdd,
  onDelete,
  onBack
}: {
  library: McpServerConfig[]
  inProject: Set<string>
  onAdd: (id: string) => void
  onDelete: (id: string) => void
  onBack: () => void
}) {
  return (
    <div className="space-y-3 p-5">
      <button onClick={onBack} className="no-drag text-xs text-ink-faint hover:text-ink">
        ← Back to project servers
      </button>
      <p className="text-sm text-ink-soft">
        The MCP store — every server you’ve configured. Add one to this project, or delete it from
        the store entirely.
      </p>

      {library.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-ink-ghost">
          The store is empty. Add an MCP server to populate it.
        </p>
      )}

      {library.map((m) => {
        const added = inProject.has(m.id)
        return (
          <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface/60 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-overlay text-ink-soft">
              {m.transport === 'stdio' ? <TerminalSquare size={16} /> : <Globe size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{m.name}</span>
              <span className="block truncate font-mono text-[11px] text-ink-faint">
                {m.transport === 'stdio'
                  ? `${m.command ?? ''} ${(m.args ?? []).join(' ')}`.trim()
                  : m.url}
              </span>
            </div>
            {added ? (
              <span className="shrink-0 rounded-full bg-mint/12 px-2.5 py-1 text-[11px] text-mint">
                in project
              </span>
            ) : (
              <Button variant="subtle" className="shrink-0 text-xs" onClick={() => onAdd(m.id)}>
                <Plus size={13} />
                Add
              </Button>
            )}
            <Button
              variant="ghost"
              className="shrink-0 px-2 py-1.5 text-ink-faint hover:text-rose"
              title="Delete from the store (removes it from every project)"
              onClick={() => onDelete(m.id)}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function McpForm({ initial, onDone }: { initial?: McpServerConfig; onDone: () => void }) {
  const saveMcpServer = useKennel((s) => s.saveMcpServer)
  const testMcpServer = useKennel((s) => s.testMcpServer)

  const [name, setName] = useState(initial?.name ?? '')
  const [transport, setTransport] = useState<McpTransport>(initial?.transport ?? 'stdio')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [argsText, setArgsText] = useState((initial?.args ?? []).join('\n'))
  const [envText, setEnvText] = useState(kvToText(initial?.env))
  const [url, setUrl] = useState(initial?.url ?? '')
  const [headersText, setHeadersText] = useState(kvToText(initial?.headers))
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [saving, setSaving] = useState(false)

  // Secrets (env/headers) aren't in the broadcast state — fetch them to edit.
  useEffect(() => {
    if (initial) {
      void window.kennel.getMcpServerSecrets(initial.id).then((s) => {
        setEnvText(kvToText(s.env))
        setHeadersText(kvToText(s.headers))
      })
    }
  }, [])
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; tools?: string[] } | null>(null)

  const valid =
    name.trim() && (transport === 'stdio' ? command.trim() : url.trim())

  const build = (): McpServerConfig => ({
    id: initial?.id ?? crypto.randomUUID(),
    name: name.trim(),
    transport,
    enabled,
    command: transport === 'stdio' ? command.trim() : undefined,
    args: transport === 'stdio' ? argsText.split('\n').map((a) => a.trim()).filter(Boolean) : undefined,
    env: transport === 'stdio' ? parseKV(envText) : undefined,
    url: transport === 'http' ? url.trim() : undefined,
    headers: transport === 'http' ? parseKV(headersText) : undefined
  })

  const test = async () => {
    if (!valid) return
    setTesting(true)
    setResult(null)
    setResult(await testMcpServer(build()))
    setTesting(false)
  }

  const save = async () => {
    if (!valid) return
    setSaving(true)
    await saveMcpServer(build())
    setSaving(false)
    onDone()
  }

  return (
    <div className="space-y-4 p-5">
      <button onClick={onDone} className="no-drag text-xs text-ink-faint hover:text-ink">
        ← Back to MCP servers
      </button>

      <div>
        <Label>Name</Label>
        <TextInput autoFocus placeholder="e.g. Filesystem, GitHub, Linear" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <Label>Transport</Label>
        <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-surface p-1">
          {(['stdio', 'http'] as McpTransport[]).map((t) => (
            <button
              key={t}
              onClick={() => setTransport(t)}
              className={clsx(
                'no-drag flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-all',
                transport === t ? 'bg-surface-overlay text-ink shadow-node' : 'text-ink-faint hover:text-ink-soft'
              )}
            >
              {t === 'stdio' ? <TerminalSquare size={14} /> : <Globe size={14} />}
              {t === 'stdio' ? 'stdio (local command)' : 'HTTP (remote)'}
            </button>
          ))}
        </div>
      </div>

      {transport === 'stdio' ? (
        <>
          <div>
            <Label>Command</Label>
            <TextInput placeholder="npx" value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono text-[13px]" />
          </div>
          <div>
            <Label>Arguments (one per line)</Label>
            <TextArea rows={3} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir'} value={argsText} onChange={(e) => setArgsText(e.target.value)} className="font-mono text-[12px]" />
          </div>
          <div>
            <Label>Environment (KEY=value per line)</Label>
            <TextArea rows={2} placeholder="API_TOKEN=sk-..." value={envText} onChange={(e) => setEnvText(e.target.value)} className="font-mono text-[12px]" />
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>Server URL</Label>
            <TextInput placeholder="https://example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-[13px]" />
          </div>
          <div>
            <Label>Headers (KEY=value per line)</Label>
            <TextArea rows={2} placeholder="Authorization=Bearer ..." value={headersText} onChange={(e) => setHeadersText(e.target.value)} className="font-mono text-[12px]" />
          </div>
        </>
      )}

      <Toggle label="Enabled" hint="Expose this server's tools to MCP-permitted personas" checked={enabled} onChange={setEnabled} />

      {result && (
        <div
          className={clsx(
            'flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm',
            result.ok ? 'border-mint/30 bg-mint/10 text-mint' : 'border-rose/30 bg-rose/10 text-rose-soft'
          )}
        >
          {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <div className="selectable">{result.message}</div>
            {result.tools && result.tools.length > 0 && (
              <div className="mt-1 font-mono text-[11px] text-ink-faint">{result.tools.slice(0, 12).join(', ')}{result.tools.length > 12 ? '…' : ''}</div>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2 pt-2">
        <Button variant="subtle" disabled={!valid || testing} onClick={test}>
          {testing ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />}
          Test connection
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || saving} onClick={save}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            Save server
          </Button>
        </div>
      </div>
    </div>
  )
}
