import { GoogleGenAI } from '@google/genai'
import {
  MAX_ITERATIONS,
  type AgentRunOptions,
  type AgentRunResult
} from './provider-types'

/** Convert our JSON-schema tool params to Gemini's (uppercase OpenAPI types). */
function toGeminiSchema(s: any): any {
  if (!s || typeof s !== 'object') return s
  const out: any = {}
  if (s.type) out.type = String(s.type).toUpperCase()
  if (s.description) out.description = s.description
  if (s.enum) out.enum = s.enum
  if (s.items) out.items = toGeminiSchema(s.items)
  if (s.properties) {
    out.properties = {}
    for (const k of Object.keys(s.properties)) out.properties[k] = toGeminiSchema(s.properties[k])
  }
  if (Array.isArray(s.required)) out.required = s.required
  return out
}

/**
 * Real agentic loop for Google models via the official @google/genai SDK.
 * Works for both Google AI Studio (Gemini Developer API, API key) and Vertex AI
 * (API key express mode, or project + location).
 */
export async function runGoogleAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const ai = opts.vertex
    ? new GoogleGenAI({
        vertexai: true,
        apiKey: opts.apiKey || undefined,
        project: opts.project || undefined,
        location: opts.location || undefined
      })
    : new GoogleGenAI({ apiKey: opts.apiKey })

  const functionDeclarations = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toGeminiSchema(t.schema)
  }))

  const config: any = {
    systemInstruction: opts.systemPrompt,
    tools: [{ functionDeclarations }],
    // Client-side cancellation so a Stop button aborts the in-flight request.
    abortSignal: opts.signal
  }

  // Gemini `contents`: alternating user/model turns with text & function parts.
  const contents: any[] = [
    ...(opts.history ?? []).map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    })),
    { role: 'user', parts: [{ text: opts.userPrompt }] }
  ]
  let finalText = ''
  let completed = false

  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS
  for (let i = 0; i < maxIterations; i++) {
    if (opts.signal.aborted) throw new Error('Run cancelled.')

    const response = await ai.models.generateContent({
      model: opts.model,
      contents,
      config
    })

    const text = response.text
    if (text && text.trim()) {
      finalText = text.trim()
      opts.emit({ type: 'assistant', text })
    }

    const calls = response.functionCalls ?? []
    if (calls.length === 0) {
      completed = true
      break
    }

    // Echo the model's turn (carrying its functionCall parts) into history.
    const modelContent =
      response.candidates?.[0]?.content ?? {
        role: 'model',
        parts: calls.map((c) => ({ functionCall: c }))
      }
    contents.push(modelContent)

    const responseParts: any[] = []
    for (const call of calls) {
      const name = call.name ?? ''
      const args = call.args ?? {}
      opts.emit({ type: 'tool_call', callId: call.id ?? name, tool: name, input: args })
      const result = await opts.execute(name, args)
      opts.emit({
        type: 'tool_result',
        callId: call.id ?? name,
        ok: result.ok,
        preview: result.content.slice(0, 600)
      })
      responseParts.push({
        functionResponse: {
          id: call.id,
          name,
          response: { output: result.content, success: result.ok }
        }
      })
    }

    contents.push({ role: 'user', parts: responseParts })
  }

  if (!completed) {
    finalText =
      (finalText ? finalText + '\n\n' : '') +
      '[Reached the step limit before finishing — stopped here.]'
  }
  return { finalText }
}
