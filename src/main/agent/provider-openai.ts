import OpenAI from 'openai'
import {
  MAX_ITERATIONS,
  type AgentRunOptions,
  type AgentRunResult
} from './provider-types'

/**
 * Real agentic loop for OpenAI and any OpenAI-compatible endpoint (local or
 * hosted) via a configurable baseURL. Uses Chat Completions function calling.
 */
export async function runOpenAIAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const client = new OpenAI({
    apiKey: opts.apiKey || 'not-needed',
    baseURL: opts.baseUrl || undefined,
    dangerouslyAllowBrowser: false
  })

  const tools = opts.tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.schema }
  }))

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.systemPrompt },
    ...(opts.history ?? []).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: opts.userPrompt }
  ]
  let finalText = ''
  let completed = false

  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS
  for (let i = 0; i < maxIterations; i++) {
    if (opts.signal.aborted) throw new Error('Run cancelled.')

    const completion = await client.chat.completions.create(
      {
        model: opts.model,
        messages,
        tools,
        tool_choice: 'auto'
      },
      { signal: opts.signal }
    )

    const choice = completion.choices[0]
    const msg = choice?.message
    if (!msg) break

    if (msg.content) {
      finalText = msg.content
      opts.emit({ type: 'assistant', text: msg.content })
    }

    const toolCalls = msg.tool_calls ?? []
    if (toolCalls.length === 0) {
      completed = true
      break
    }

    // Push the assistant message (with its tool calls) before the results.
    messages.push({
      role: 'assistant',
      content: msg.content ?? '',
      tool_calls: toolCalls
    })

    for (const call of toolCalls) {
      if (call.type !== 'function') continue
      let input: unknown = {}
      try {
        input = call.function.arguments ? JSON.parse(call.function.arguments) : {}
      } catch {
        input = {}
      }
      opts.emit({ type: 'tool_call', callId: call.id, tool: call.function.name, input })
      const result = await opts.execute(call.function.name, input)
      opts.emit({
        type: 'tool_result',
        callId: call.id,
        ok: result.ok,
        preview: result.content.slice(0, 600)
      })
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.content })
    }
  }

  if (!completed) {
    finalText =
      (finalText ? finalText + '\n\n' : '') +
      '[Reached the step limit before finishing — stopped here.]'
  }
  return { finalText }
}
