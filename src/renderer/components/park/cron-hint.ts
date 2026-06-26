// Lightweight cron validity check for UI feedback. The authoritative parser
// lives in the main process (services/cron.ts); a schedule that this accepts but
// the real parser rejects simply never fires.
const FIELD = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/

export function cronValid(expr: string): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return false
  return fields.every((f) => FIELD.test(f))
}
