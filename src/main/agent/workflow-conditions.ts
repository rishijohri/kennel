import type { ActivationCondition, WorkflowNode } from '@shared/types'

/** The value of an upstream node's last-run result for a given condition field. */
export function fieldValue(
  node: WorkflowNode | undefined,
  field: ActivationCondition['field']
): string {
  if (!node) return ''
  switch (field) {
    case 'resultState':
      return node.resultState ?? ''
    case 'resultStateKind':
      return node.resultStateKind ?? ''
    case 'outputValue':
      return node.outputValue ?? node.summary ?? node.output ?? ''
    case 'output':
      return node.output ?? node.outputValue ?? ''
    case 'exitCode':
      return node.exitCode == null ? '' : String(node.exitCode)
    case 'status':
      return node.status ?? ''
    default:
      return ''
  }
}

/**
 * Evaluate one activation condition against a node's last-run result. The source
 * must have actually produced a result (not idle/skipped), else the branch can't
 * fire. The `value` is the tunable knob the Walker adjusts across runs.
 */
export function evalActivation(cond: ActivationCondition, source: WorkflowNode | undefined): boolean {
  if (!source || source.status === 'idle' || source.status === 'skipped' || source.status == null) {
    return false
  }
  const actual = fieldValue(source, cond.field)
  const expected = cond.value ?? ''
  const numA = Number(actual)
  const numB = Number(expected)
  const bothNum =
    actual.trim() !== '' && expected.trim() !== '' && !Number.isNaN(numA) && !Number.isNaN(numB)
  switch (cond.op) {
    case 'eq':
      return actual === expected
    case 'neq':
      return actual !== expected
    case 'contains':
      return actual.toLowerCase().includes(expected.toLowerCase())
    case 'notContains':
      return !actual.toLowerCase().includes(expected.toLowerCase())
    case 'matches':
      try {
        return new RegExp(expected, 'i').test(actual)
      } catch {
        return false
      }
    case 'gt':
      return bothNum && numA > numB
    case 'lt':
      return bothNum && numA < numB
    case 'gte':
      return bothNum && numA >= numB
    case 'lte':
      return bothNum && numA <= numB
    case 'truthy':
      return actual.trim() !== '' && actual !== '0' && actual.toLowerCase() !== 'false'
    case 'falsy':
      return actual.trim() === '' || actual === '0' || actual.toLowerCase() === 'false'
    default:
      return false
  }
}
