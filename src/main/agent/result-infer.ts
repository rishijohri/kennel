import type { ResultStateKind, ResultStateRule } from '@shared/types'

/** Substitute {{name}} / ${name} placeholders in a command template. */
export function applyInputs(command: string, inputs: Record<string, string>): string {
  return command.replace(
    /\{\{\s*(\w+)\s*\}\}|\$\{\s*(\w+)\s*\}/g,
    (_m, a: string, b: string) => inputs[a ?? b] ?? ''
  )
}

export interface ExecutionResult {
  spawnError: boolean
  exitCode: number | null
  output: string
}

/**
 * Map an execution result to a named state using the process's rules.
 * Rules are evaluated in order; the first match wins. Sensible defaults apply
 * when no rule matches (spawn error → "failed to start"; exit 0 → "success").
 */
export function inferResult(
  rules: ResultStateRule[],
  ctx: ExecutionResult
): { state: string; kind: ResultStateKind } {
  if (ctx.spawnError) {
    // Prefer an explicit spawn-error rule, then a catch-all default, then the fallback.
    const r = rules.find((x) => x.when === 'spawn-error') ?? rules.find((x) => x.when === 'default')
    return r ? { state: r.state, kind: r.kind } : { state: 'failed to start', kind: 'failure' }
  }

  for (const r of rules) {
    let match = false
    switch (r.when) {
      case 'exit-zero':
        match = ctx.exitCode === 0
        break
      case 'exit-nonzero':
        match = ctx.exitCode != null && ctx.exitCode !== 0
        break
      case 'exit-code':
        match = ctx.exitCode === r.exitCode
        break
      case 'output-contains':
        match = Boolean(r.pattern) && ctx.output.toLowerCase().includes(r.pattern!.toLowerCase())
        break
      case 'output-matches':
        try {
          match = Boolean(r.pattern) && new RegExp(r.pattern!).test(ctx.output)
        } catch {
          match = false
        }
        break
      case 'default':
        match = true
        break
      case 'spawn-error':
        match = false
        break
    }
    if (match) return { state: r.state, kind: r.kind }
  }

  return ctx.exitCode === 0
    ? { state: 'success', kind: 'success' }
    : { state: 'failed', kind: 'failure' }
}
