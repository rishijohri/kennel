import type { ProviderKind } from '@shared/types'
import { runAnthropicAgent } from './provider-anthropic'
import { runOpenAIAgent } from './provider-openai'
import { runGoogleAgent } from './provider-google'
import { runCopilotAgent } from './provider-copilot'
import type { AgentRunOptions, AgentRunResult } from './provider-types'

/** Hugging Face Inference Providers expose an OpenAI-compatible chat endpoint here. */
export const HF_ROUTER_URL = 'https://router.huggingface.co/v1'

/** Dispatch an agent run to the correct provider implementation. */
export function runWithProvider(
  kind: ProviderKind,
  opts: AgentRunOptions
): Promise<AgentRunResult> {
  if (kind === 'anthropic') return runAnthropicAgent(opts)
  if (kind === 'google' || kind === 'google-vertex') return runGoogleAgent(opts)
  // Copilot ignores Kennel's tools/execute — it runs its own loop in opts.cwd.
  if (kind === 'copilot') return runCopilotAgent(opts)
  // openai + openai-compatible + huggingface all use the OpenAI Chat Completions
  // loop. HF's router is OpenAI-compatible, so we just force its base URL (the HF
  // token rides along as opts.apiKey).
  const baseUrl = kind === 'huggingface' ? HF_ROUTER_URL : opts.baseUrl
  return runOpenAIAgent({ ...opts, baseUrl })
}
