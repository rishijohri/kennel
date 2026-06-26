// Minimal, dependency-free 5-field cron: "minute hour day-of-month month day-of-week".
// Supports *, */n, a-b, a-b/n, and comma lists. Day-of-week is 0-6 (0=Sunday);
// 7 is accepted as Sunday. Evaluated against local time at minute resolution.

export interface CronParts {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domStar: boolean
  dowStar: boolean
}

function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const [rangeRaw, stepRaw] = part.split('/')
    let step = 1
    if (stepRaw !== undefined) {
      step = Number.parseInt(stepRaw, 10)
      if (!Number.isFinite(step) || step <= 0) return null
    }
    let lo = min
    let hi = max
    if (rangeRaw === '*') {
      // full range
    } else if (rangeRaw.includes('-')) {
      const [a, b] = rangeRaw.split('-').map((x) => Number.parseInt(x, 10))
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null
      lo = a
      hi = b
    } else {
      const v = Number.parseInt(rangeRaw, 10)
      if (!Number.isFinite(v)) return null
      lo = v
      hi = v
    }
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out.size ? out : null
}

export function parseCron(expr: string): CronParts | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const minute = parseField(fields[0], 0, 59)
  const hour = parseField(fields[1], 0, 23)
  const dom = parseField(fields[2], 1, 31)
  const month = parseField(fields[3], 1, 12)
  const dow = parseField(fields[4], 0, 7)
  if (!minute || !hour || !dom || !month || !dow) return null
  if (dow.has(7)) dow.add(0)
  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domStar: fields[2] === '*',
    dowStar: fields[4] === '*'
  }
}

export function cronValid(expr: string): boolean {
  return parseCron(expr) !== null
}

export function cronMatches(parts: CronParts, date: Date): boolean {
  const minOk = parts.minute.has(date.getMinutes())
  const hourOk = parts.hour.has(date.getHours())
  const monthOk = parts.month.has(date.getMonth() + 1)
  const domHit = parts.dom.has(date.getDate())
  const dowHit = parts.dow.has(date.getDay())
  // Standard cron: when BOTH day fields are restricted, match if EITHER hits.
  const dayOk =
    !parts.domStar && !parts.dowStar ? domHit || dowHit : domHit && dowHit
  return minOk && hourOk && monthOk && dayOk
}
