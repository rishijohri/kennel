import type { ActivationCondition, ActivationField, ActivationOp } from '@shared/types'

export const FIELD_OPTIONS: { value: ActivationField; label: string }[] = [
  { value: 'resultStateKind', label: 'result kind (success/failure/neutral)' },
  { value: 'resultState', label: 'result-state label' },
  { value: 'outputValue', label: 'output' },
  { value: 'exitCode', label: 'exit code' },
  { value: 'status', label: 'status (done/error/skipped)' },
  { value: 'output', label: 'raw log' }
]

export const OP_OPTIONS: { value: ActivationOp; label: string; needsValue: boolean }[] = [
  { value: 'eq', label: '= equals', needsValue: true },
  { value: 'neq', label: '≠ not equal', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'notContains', label: "doesn't contain", needsValue: true },
  { value: 'matches', label: 'matches regex', needsValue: true },
  { value: 'gt', label: '> greater than', needsValue: true },
  { value: 'lt', label: '< less than', needsValue: true },
  { value: 'gte', label: '≥ at least', needsValue: true },
  { value: 'lte', label: '≤ at most', needsValue: true },
  { value: 'truthy', label: 'is truthy', needsValue: false },
  { value: 'falsy', label: 'is falsy / empty', needsValue: false }
]

const OP_SYMBOL: Record<ActivationOp, string> = {
  eq: '=',
  neq: '≠',
  contains: '⊃',
  notContains: '⊅',
  matches: '~',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  truthy: 'is truthy',
  falsy: 'is falsy'
}

const FIELD_SHORT: Record<ActivationField, string> = {
  resultStateKind: 'kind',
  resultState: 'state',
  outputValue: 'output',
  exitCode: 'exit',
  status: 'status',
  output: 'log'
}

/** A compact one-line summary of a condition, e.g. "kind = failure" — for edge labels. */
export function summarizeActivation(cond: ActivationCondition, sourceTitle?: string): string {
  const lhs = sourceTitle ? `${sourceTitle}.${FIELD_SHORT[cond.field]}` : FIELD_SHORT[cond.field]
  if (cond.op === 'truthy' || cond.op === 'falsy') return `${lhs} ${OP_SYMBOL[cond.op]}`
  return `${lhs} ${OP_SYMBOL[cond.op]} ${cond.value ?? ''}`.trim()
}

export function opNeedsValue(op: ActivationOp): boolean {
  return op !== 'truthy' && op !== 'falsy'
}
