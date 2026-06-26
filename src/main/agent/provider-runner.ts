import type { ProviderKind } from '@shared/types'
import { runAnthropicAgent } from './provider-anthropic'
import { runOpenAIAgent } from './provider-openai'
import { runGoogleAgent } from './provider-google'
import type { AgentRunOptions, AgentRunResult } from './provider-types'

/** Dispatch an agent run to the correct provider implementation. */
export function runWithProvider(
  kind: ProviderKind,
  opts: AgentRunOptions
): Promise<AgentRunResult> {
  if (kind === 'anthropic') return runAnthropicAgent(opts)
  if (kind === 'google' || kind === 'google-vertex') return runGoogleAgent(opts)
  return runOpenAIAgent(opts) // openai + openai-compatible
}
