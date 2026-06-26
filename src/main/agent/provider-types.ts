import type { Effort } from '@shared/types'
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
}

export interface AgentRunResult {
  /** The final assistant text, used to summarize the node. */
  finalText: string
}

/** Safety cap on the number of model ↔ tool round-trips per run. */
export const MAX_ITERATIONS = 60
