import type { Effort, Permissions } from '@shared/types'
import type { ToolDef } from './tools'

export type AgentStreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'tool_call'; callId: string; tool: string; input: unknown }
  | { type: 'tool_result'; callId: string; ok: boolean; preview: string }
  | { type: 'status'; text: string }

/** Executes a tool call and returns the result. Injected per run. */
export type ToolExecutor = (
  name: string,
  input: unknown
) => Promise<{ ok: boolean; content: string }>

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentRunOptions {
  apiKey: string
  baseUrl?: string
  model: string
  systemPrompt: string
  userPrompt: string
  effort: Effort
  tools: ToolDef[]
  execute: ToolExecutor
  /** Prior conversation turns (for multi-turn chat, e.g. the Care Taker). */
  history?: ConversationTurn[]
  emit: (e: AgentStreamEvent) => void
  signal: AbortSignal
  /** Google Vertex AI routing (vs. the Gemini Developer / AI Studio API). */
  vertex?: boolean
  project?: string
  location?: string
  /** Override the default model↔tool round-trip cap (e.g. the Walker orchestrator). */
  maxIterations?: number
  /**
   * Working directory the agent operates in. The chat-completion providers ignore
   * this (their file ops go through `execute`/ToolContext), but external-CLI
   * providers like Copilot run their OWN agentic loop directly in this directory.
   */
  cwd?: string
  /**
   * The persona's permissions, mapped to an external-engine provider's own tool
   * gating (e.g. Copilot's excludedTools / onPreToolUse). The chat-completion
   * providers gate via the injected `tools`/`execute` instead and ignore this.
   */
  permissions?: Permissions
  /**
   * Copilot only. When true (Walker / Care Taker), the injected Kennel `tools`
   * are exposed to Copilot as custom SDK tools (orchestration mode) and Copilot's
   * native coding tools are disabled. When false/omitted (canvas + Park steps),
   * Copilot uses its OWN native coding tools and `tools`/`execute` are ignored.
   */
  exposeKennelTools?: boolean
  /** Copilot only: tool names to allow-list (availableTools). Empty/undefined = all. */
  copilotAllow?: string[]
  /** Copilot only: tool names to deny (excludedTools; always wins). */
  copilotDeny?: string[]
}

export interface AgentRunResult {
  /** The final assistant text, used to summarize the node. */
  finalText: string
}

/** Safety cap on the number of model ↔ tool round-trips per run. */
export const MAX_ITERATIONS = 60
