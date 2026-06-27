import { app } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServerConfig } from '@shared/types'
import type { ToolDef } from '../agent/tools'
import { store } from './store'

interface Conn {
  client: Client
  hash: string
}

// One cached connection per server id; rebuilt when the config changes.
const conns = new Map<string, Conn>()
// Namespaced tool name → which server + original tool it routes to.
const registry = new Map<string, { serverId: string; tool: string }>()

function configHash(s: McpServerConfig): string {
  return JSON.stringify({
    t: s.transport,
    c: s.command,
    a: s.args,
    e: s.env,
    u: s.url,
    h: s.headers
  })
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'mcp'
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s.`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

function makeTransport(server: McpServerConfig) {
  if (server.transport === 'stdio') {
    if (!server.command) throw new Error('This stdio MCP server has no command set.')
    // Only the SDK's safe default env (PATH, HOME, …) plus the server's own
    // declared vars — never the parent's full environment (which holds the
    // user's API keys etc.) to an arbitrary user-configured command.
    const env: Record<string, string> = { ...getDefaultEnvironment(), ...(server.env ?? {}) }
    return new StdioClientTransport({ command: server.command, args: server.args ?? [], env })
  }
  if (!server.url) throw new Error('This HTTP MCP server has no URL set.')
  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: server.headers ?? {} }
  })
}

async function newClient(server: McpServerConfig): Promise<Client> {
  const client = new Client({ name: 'kennel', version: app.getVersion() }, { capabilities: {} })
  const transport = makeTransport(server)
  try {
    await withTimeout(client.connect(transport), 20_000, `Connecting to "${server.name}"`)
  } catch (err) {
    // On a connect timeout the SDK never tears down — close ourselves so the
    // spawned stdio child is killed instead of orphaned.
    try {
      await client.close()
    } catch {
      /* ignore */
    }
    try {
      await transport.close()
    } catch {
      /* ignore */
    }
    throw err
  }
  return client
}

async function connect(server: McpServerConfig): Promise<Client> {
  const h = configHash(server)
  const existing = conns.get(server.id)
  if (existing && existing.hash === h) return existing.client
  if (existing) {
    try {
      await existing.client.close()
    } catch {
      /* ignore */
    }
    conns.delete(server.id)
  }
  const client = await newClient(server)
  conns.set(server.id, { client, hash: h })
  return client
}

export function dropMcpConnection(id: string): void {
  const c = conns.get(id)
  if (c) {
    c.client.close().catch(() => {})
    conns.delete(id)
  }
}

export async function disconnectMcp(): Promise<void> {
  for (const { client } of conns.values()) {
    try {
      await client.close()
    } catch {
      /* ignore */
    }
  }
  conns.clear()
  registry.clear()
}

function formatContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? {})
  const out = content
    .map((c: any) => {
      if (c?.type === 'text') return c.text
      if (c?.type === 'image') return '[image]'
      if (c?.type === 'resource') return `[resource ${c.resource?.uri ?? ''}]`
      return JSON.stringify(c)
    })
    .join('\n')
  return out.length > 20_000 ? out.slice(0, 20_000) + '\n…[truncated]' : out
}

/**
 * Connect to every enabled MCP server, list its tools, and return them as
 * namespaced ToolDefs (mcp__<server>__<tool>). Rebuilds the routing registry.
 * Unreachable servers are skipped (logged), never failing the whole run.
 */
export async function getMcpToolDefs(): Promise<ToolDef[]> {
  registry.clear()
  const defs: ToolDef[] = []
  const used = new Set<string>()
  for (const server of store.getMcpServers()) {
    if (!server.enabled) continue
    try {
      const client = await connect(server)
      const { tools } = await withTimeout(client.listTools(), 15_000, `Listing tools for "${server.name}"`)
      const slug = sanitize(server.name)
      for (const t of tools) {
        let name = `mcp__${slug}__${sanitize(t.name)}`.slice(0, 64)
        let n = 1
        while (used.has(name)) name = `${name.slice(0, 60)}_${n++}`
        used.add(name)
        registry.set(name, { serverId: server.id, tool: t.name })
        defs.push({
          name,
          description: `[MCP · ${server.name}] ${t.description ?? t.name}`,
          schema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} }
        })
      }
    } catch (err) {
      // Drop the (possibly dead) cached connection so the next gather retries fresh.
      dropMcpConnection(server.id)
      console.error(`[mcp] "${server.name}" unavailable:`, (err as Error)?.message ?? err)
    }
  }
  return defs
}

export async function callMcpTool(
  name: string,
  args: unknown
): Promise<{ ok: boolean; content: string }> {
  const route = registry.get(name)
  if (!route) return { ok: false, content: `Unknown MCP tool "${name}".` }
  const server = store.getMcpServer(route.serverId)
  if (!server) return { ok: false, content: 'That MCP server is no longer configured.' }
  try {
    const client = await connect(server)
    const result: any = await withTimeout(
      client.callTool({ name: route.tool, arguments: (args ?? {}) as Record<string, unknown> }),
      120_000,
      `MCP tool "${route.tool}"`
    )
    return { ok: !result?.isError, content: formatContent(result?.content) }
  } catch (err: any) {
    return { ok: false, content: `MCP call failed: ${err?.message ?? String(err)}` }
  }
}

/** Test an (unsaved) server config without caching the connection. */
export async function testMcpServer(
  server: McpServerConfig
): Promise<{ ok: boolean; message: string; tools?: string[] }> {
  let client: Client | null = null
  try {
    client = await newClient(server)
    const { tools } = await withTimeout(client.listTools(), 15_000, 'Listing tools')
    return {
      ok: true,
      message: `Connected — ${tools.length} tool${tools.length === 1 ? '' : 's'} available.`,
      tools: tools.map((t) => t.name)
    }
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) }
  } finally {
    try {
      await client?.close()
    } catch {
      /* ignore */
    }
  }
}
