// ── GitHub Copilot run path (via @github/copilot-sdk) ───────────────────────
// A persona on the `copilot` provider runs through the GitHub Copilot SDK, which
// drives Copilot's own agentic loop against the node's working tree. Auth rides
// the signed-in CLI login (useLoggedInUser); the SDK bundles its own runtime.
//
// Two modes:
//  • coding (canvas nodes + Park steps): Copilot uses its OWN native tools
//    (read/write/shell/grep). The persona's permissions are enforced by a real
//    onPermissionRequest handler that denies by SDK permission KIND (the security
//    boundary); excludedTools (permission name-superset + the persona's deny list)
//    is a best-effort UX layer so the model doesn't waste turns on blocked tools.
//  • orchestration (Walker / Care Taker): Kennel's own tools (spawn_node, …) are
//    exposed to Copilot as custom SDK tools, and native coding tools are disabled,
//    so Copilot orchestrates the canvas instead of editing code directly.

import type { AgentRunOptions, AgentRunResult, AgentStreamEvent } from './provider-types'
import type { ToolDef } from './tools'
import { assertCopilotReady, resolveCopilotToken } from '../services/copilot-cli'

/** If the session emits no event at all within this window of the first send,
 *  the runtime is almost certainly blocked authenticating — typically a macOS
 *  Keychain prompt (no token). Real work emits session.start near-instantly, so
 *  this only fires on a true startup stall and never kills a long-running turn. */
const STARTUP_MS = 90_000

async function loadSdk() {
  return import('@github/copilot-sdk')
}

/** Best-effort excludedTools (UX layer) from permissions + the persona deny list.
 *  The real security boundary is the onPermissionRequest handler (by kind). */
function deriveExcluded(opts: AgentRunOptions): string[] {
  const p = opts.permissions
  const out = new Set<string>(opts.copilotDeny ?? [])
  if (p && !p.canEditFiles) {
    for (const n of ['write', 'edit', 'create', 'str_replace', 'str_replace_editor', 'apply_patch', 'create_file', 'edit_file', 'multi_edit', 'delete_file']) out.add(n)
  }
  if (p && !p.canRunBash) {
    for (const n of ['bash', 'shell', 'run_command', 'run_in_terminal', 'terminal', 'execute']) out.add(n)
  }
  if (p && !p.canSearchWeb) {
    for (const n of ['fetch', 'web_fetch', 'web_search', 'fetch_url', 'browser']) out.add(n)
  }
  return [...out]
}

const clip = (s: unknown, n = 300): string => String(s ?? '').slice(0, n)

export async function runCopilotAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  await assertCopilotReady()
  if (!opts.cwd) throw new Error('Copilot run has no working directory.')

  const { CopilotClient, defineTool, approveAll, ToolSet, BuiltInTools } = await loadSdk()

  const orchestration = Boolean(opts.exposeKennelTools)
  let toolSeq = 0
  const emit = (e: AgentStreamEvent) => opts.emit(e)

  // ── Custom tools (orchestration only): wrap Kennel's ToolDef[]+execute. ─────
  const customTools = orchestration
    ? (opts.tools as ToolDef[]).map((t) =>
        defineTool(t.name, {
          description: t.description,
          parameters: t.schema,
          skipPermission: true,
          handler: async (args: unknown) => {
            const callId = `${t.name}-${++toolSeq}`
            emit({ type: 'tool_call', callId, tool: t.name, input: args })
            try {
              const r = await opts.execute(t.name, args)
              emit({ type: 'tool_result', callId, ok: r.ok, preview: clip(r.content) })
              return r.ok ? r.content : { textResultForLlm: r.content, resultType: 'failure', error: r.content }
            } catch (e: any) {
              const msg = e?.message ?? String(e)
              emit({ type: 'tool_result', callId, ok: false, preview: clip(msg) })
              return { textResultForLlm: msg, resultType: 'failure', error: msg }
            }
          }
        })
      )
    : undefined

  // ── Tool gating ────────────────────────────────────────────────────────────
  let availableTools: string[] | undefined
  let excludedTools: string[] | undefined
  if (orchestration) {
    availableTools = new ToolSet().addCustom('*').addBuiltIn(BuiltInTools.Isolated).toArray()
    excludedTools = opts.copilotDeny?.length ? opts.copilotDeny : undefined
  } else {
    availableTools = opts.copilotAllow?.length ? opts.copilotAllow : undefined
    const ex = deriveExcluded(opts)
    excludedTools = ex.length ? ex : undefined
  }

  // ── Permission handler (the security boundary) — deny by SDK kind. ──────────
  const p = opts.permissions
  const deny = new Set(opts.copilotDeny ?? [])
  const onPermissionRequest = async (req: any, inv: any) => {
    const kind = req?.kind
    const reject = (feedback: string) => ({ kind: 'reject' as const, feedback })
    if (p) {
      if (kind === 'write' && !p.canEditFiles) return reject('File edits are disabled for this persona.')
      if (kind === 'shell' && !p.canRunBash) return reject('Shell is disabled for this persona.')
      if (kind === 'url' && !p.canSearchWeb) return reject('Web/URL access is disabled for this persona.')
      if (kind === 'mcp' && !p.canUseMcp) return reject('MCP access is disabled for this persona.')
      if (kind === 'memory' && !p.canEditCoreMemory) return reject('Core memory is protected for this persona.')
    }
    if (req?.toolName && deny.has(req.toolName)) return reject(`Tool "${req.toolName}" is denied for this persona.`)
    return approveAll(req, inv)
  }

  // Prefer an env / gh token (passed as gitHubToken) so the runtime never reads
  // the Keychain — which prompts and blocks the run in unsigned/dev builds. Fall
  // back to the stored login (Keychain) only when no token is available.
  const token = await resolveCopilotToken()
  const client = new CopilotClient({
    workingDirectory: opts.cwd,
    ...(token ? { gitHubToken: token } : { useLoggedInUser: true }),
    logLevel: 'error'
  })

  let finalText = ''
  let streamed = '' // fallback when the final assistant turn carries no prose
  let sawError: string | null = null
  let settled = false
  let onAbort: (() => void) | null = null
  const unsubs: Array<() => void> = []

  try {
    await client.start()
    const session = await client.createSession({
      model: opts.model || 'auto',
      systemMessage: { mode: 'append', content: opts.systemPrompt },
      skipCustomInstructions: true,
      onPermissionRequest,
      tools: customTools,
      availableTools,
      excludedTools
    })

    // Stream assistant text + reasoning; capture the final (non-empty) message.
    unsubs.push(
      session.on('assistant.message_delta', (e: any) => {
        const t = e?.data?.deltaContent
        if (t) {
          streamed += t
          emit({ type: 'assistant', text: t })
        }
      })
    )
    unsubs.push(
      session.on('assistant.message', (e: any) => {
        // A tool-only turn legitimately has content: "" — never let it clobber a
        // real answer (mirrors provider-anthropic/openai).
        const c = e?.data?.content
        if (typeof c === 'string' && c.trim()) finalText = c
      })
    )
    unsubs.push(
      session.on('assistant.reasoning_delta', (e: any) => {
        const t = e?.data?.deltaContent ?? e?.data?.content
        if (t) emit({ type: 'thinking', text: String(t) })
      })
    )
    // Tool visibility (coding mode): bridge off the execution events, which carry
    // a stable toolCallId and fire for every terminal outcome. (Orchestration's
    // custom-tool handlers emit their own events, so don't double-count here.)
    if (!orchestration) {
      unsubs.push(
        session.on('tool.execution_start', (e: any) => {
          const d = e?.data
          if (d?.toolCallId) emit({ type: 'tool_call', callId: d.toolCallId, tool: d.toolName ?? 'tool', input: d.arguments })
        })
      )
      unsubs.push(
        session.on('tool.execution_complete', (e: any) => {
          const d = e?.data
          if (!d?.toolCallId) return
          const errMsg = d.error && (d.error.message || d.error.text || JSON.stringify(d.error))
          const ok = Boolean(d.success)
          const preview = ok ? clip(typeof d.result === 'string' ? d.result : JSON.stringify(d.result ?? 'ok')) : clip(errMsg || 'failed')
          emit({ type: 'tool_result', callId: d.toolCallId, ok, preview })
        })
      )
    }
    unsubs.push(
      session.on('session.error', (e: any) => {
        sawError = e?.data?.message ?? e?.data?.error ?? 'Copilot session error.'
      })
    )

    await new Promise<void>((resolve, reject) => {
      let started = false
      let startupTimer: ReturnType<typeof setTimeout> | undefined
      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        if (startupTimer) clearTimeout(startupTimer)
        err ? reject(err) : resolve()
      }
      // The first event means auth succeeded and work began — stop the watchdog.
      unsubs.push(
        session.on(() => {
          if (!started) {
            started = true
            if (startupTimer) clearTimeout(startupTimer)
          }
        })
      )
      unsubs.push(session.on('session.idle', () => finish()))
      unsubs.push(session.on('session.error', () => finish(new Error(sawError ?? 'Copilot session error.'))))
      startupTimer = setTimeout(() => {
        if (started) return
        void session.abort().catch(() => {})
        finish(
          new Error(
            'Copilot did not start within 90s — the runtime is likely blocked authenticating. If a macOS Keychain prompt appeared, click “Always Allow”; otherwise sign in with the GitHub CLI (`gh auth login`) or set GH_TOKEN so Kennel can authenticate without the Keychain.'
          )
        )
      }, STARTUP_MS)
      onAbort = () => {
        void session.abort().catch(() => {})
        finish(new Error('Run cancelled.'))
      }
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    })

    // An error observed alongside a (possibly racing) idle still fails the run.
    if (sawError) throw new Error(sawError)

    await session.disconnect().catch(() => {})
    return { finalText: (finalText || streamed).trim() }
  } catch (err: any) {
    if (opts.signal.aborted) throw new Error('Run cancelled.')
    throw new Error(sawError ?? err?.message ?? String(err))
  } finally {
    if (onAbort) opts.signal.removeEventListener('abort', onAbort)
    for (const off of unsubs) {
      try {
        off()
      } catch {
        // handlers are also released by disconnect(); ignore
      }
    }
    await client.stop().catch(() => {})
  }
}
