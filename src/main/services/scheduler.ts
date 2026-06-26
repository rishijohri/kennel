import { cronMatches, parseCron } from './cron'
import { store } from './store'
import { isBusy } from '../agent/run-manager'
import { runWorkflow } from '../agent/workflow-runner'
import { isWalkerBusy } from '../agent/walker'
import { isCaretakerBusy } from '../agent/caretaker'

// Fires schedule Parks whose cron matches the current minute. Checks every 30s
// and dedupes per minute, so a run happens at most once per matching minute.

let timer: ReturnType<typeof setInterval> | null = null
const lastFired = new Map<string, string>()

function minuteKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}T${d.getHours()}:${d.getMinutes()}`
}

async function tick(): Promise<void> {
  const now = new Date()
  const key = minuteKey(now)
  for (const park of store.getParks()) {
    if (park.parkKind !== 'schedule' || !park.scheduleEnabled || !park.cron) continue
    const parts = parseCron(park.cron)
    if (!parts || !cronMatches(parts, now)) continue
    if (lastFired.get(park.id) === key) continue
    lastFired.set(park.id, key)
    // Skip while the tree is busy OR an agent session owns exclusivity (the
    // Walker may be building/running a Park between tool calls with the tree
    // momentarily free) — fires again next matching minute.
    if (isBusy() || isWalkerBusy() || isCaretakerBusy()) continue
    try {
      // Scheduled runs are real automation — record them in the Park's history.
      await runWorkflow(park.id, 'schedule', 'recorded')
    } catch {
      /* failure is recorded on the park's lastRun */
    }
  }
}

export function startScheduler(): void {
  if (timer) return
  timer = setInterval(() => void tick(), 30_000)
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
