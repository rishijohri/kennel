import Anthropic from '@anthropic-ai/sdk'
import {
  MAX_ITERATIONS,
  type AgentRunOptions,
  type AgentRunResult
} from './provider-types'

/**
 * Real Claude agentic loop using the Messages API manual tool-use loop with
 * adaptive thinking + effort. Streams text and thinking to the renderer.
 */
export async function runAnthropicAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const client = new Anthropic({ apiKey: opts.apiKey })

  const tools = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.schema as Anthropic.Tool.InputSchema
  }))

  const messages: Anthropic.MessageParam[] = [
    ...(opts.history ?? []).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: opts.userPrompt }
  ]
  let finalText = ''
  let completed = false

  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS
  for (let i = 0; i < maxIterations; i++) {
    if (opts.signal.aborted) throw new Error('Run cancelled.')

    // Built loosely so newer adaptive-thinking / effort fields don't depend on
    // a specific @anthropic-ai/sdk type version.
    const body: any = {
      model: opts.model,
      max_tokens: 16000,
      system: opts.systemPrompt,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: opts.effort },
      tools,
      messages
    }
    const stream = client.messages.stream(body, { signal: opts.signal })

    let turnText = ''
    for await (const event of stream as any) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          turnText += event.delta.text
          opts.emit({ type: 'assistant', text: event.delta.text })
        } else if (event.delta.type === 'thinking_delta') {
          opts.emit({ type: 'thinking', text: event.delta.thinking })
        }
      }
    }

    const response = await stream.finalMessage()
    if (turnText.trim()) finalText = turnText.trim()

    if (response.stop_reason !== 'tool_use') {
      completed = true
      break
    }

    // Echo the assistant turn (preserving thinking + tool_use blocks).
    messages.push({ role: 'assistant', content: response.content as any })

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      opts.emit({ type: 'tool_call', callId: block.id, tool: block.name, input: block.input })
      const result = await opts.execute(block.name, block.input)
      opts.emit({
        type: 'tool_result',
        callId: block.id,
        ok: result.ok,
        preview: result.content.slice(0, 600)
      })
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.content,
        is_error: !result.ok
      })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  if (!completed) {
    finalText =
      (finalText ? finalText + '\n\n' : '') +
      '[Reached the step limit before finishing — stopped here.]'
  }
  return { finalText }
}
