import type { IoContract, WorkflowNode } from '@shared/types'

/**
 * Airflow-XCom-style cross-node communication for Park workflows.
 *
 * Each node PUSHES named outputs (a JSON object of key→value, or a single
 * `return_value`) into the run; downstream nodes PULL named inputs by binding
 * each declared input to an upstream node's output key. These pure helpers are
 * shared by the workflow runner and the Park Care Taker's node tester.
 */

/** Parse a string as a flat JSON object → string values; null if it isn't an object. */
export function parseNamedOutputs(text: string): Record<string, string> | null {
  const t = text.trim()
  if (!t.startsWith('{')) return null
  try {
    const v = JSON.parse(t)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const out: Record<string, string> = {}
    for (const [k, val] of Object.entries(v)) {
      out[k] = typeof val === 'string' ? val : JSON.stringify(val)
    }
    return out
  } catch {
    return null
  }
}

/** Turn a raw output string into named XCom outputs (a JSON object → its keys,
 *  otherwise a single `return_value`). `primary` is the headline value. */
export function toOutputs(raw: string): { outputs: Record<string, string>; primary: string } {
  const trimmed = raw.trim()
  const named = parseNamedOutputs(trimmed)
  if (named && Object.keys(named).length > 0) {
    const primary = named.return_value ?? trimmed
    return { outputs: named, primary }
  }
  return { outputs: { return_value: trimmed }, primary: trimmed }
}

/** Pull one XCom value from a producing node's stored outputs. */
export function pullXcom(node: WorkflowNode | undefined, key: string): string | undefined {
  if (!node) return undefined
  if (node.outputs && key in node.outputs) return node.outputs[key]
  if (key === 'return_value') return node.outputValue
  return undefined
}

/** Resolve a node's declared inputs to concrete values via its bindings. */
export function resolveInputs(
  contract: IoContract | undefined,
  bindings: WorkflowNode['inputBindings'],
  byId: Map<string, WorkflowNode>
): Record<string, string> {
  const resolved: Record<string, string> = {}
  if (!contract) return resolved
  for (const field of contract.inputs) {
    const bind = bindings?.[field.key]
    if (!bind) continue
    const val = pullXcom(byId.get(bind.sourceNodeId), bind.key)
    if (val != null) resolved[field.key] = val
  }
  return resolved
}

/** Markdown "Inputs" block injected into an agentic node's prompt. */
export function formatInputsBlock(
  contract: IoContract | undefined,
  resolved: Record<string, string>
): string {
  if (!contract || contract.inputs.length === 0) return ''
  const lines = contract.inputs.map((f) => {
    const val = resolved[f.key]
    const v = val == null ? '(not provided)' : val.length > 4000 ? val.slice(0, 4000) + '…' : val
    return `- **${f.key}** (${f.format})${f.example ? ` — e.g. ${f.example}` : ''}:\n${v}`
  })
  return `## Inputs (from upstream nodes via XCom)\n${lines.join('\n')}\n\n`
}

/** Markdown describing the OUTPUTS this node must push, from its contract. */
export function formatOutputContract(contract: IoContract | undefined): string {
  if (!contract || contract.outputs.length === 0) return ''
  return contract.outputs
    .map(
      (f) =>
        `- **${f.key}** (${f.format})${f.example ? ` — e.g. ${f.example}` : ''}${f.description ? ` — ${f.description}` : ''}`
    )
    .join('\n')
}
