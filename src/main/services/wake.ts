import { powerSaveBlocker } from 'electron'

/**
 * Wake Mode — keeps the user's device awake while Kennel is working so a long
 * agent/process run isn't paused (or its provider connection dropped) when the
 * machine would otherwise sleep.
 *
 * Backed by Electron's real `powerSaveBlocker`. We use `prevent-display-sleep`,
 * which keeps both the display and the system awake (the caffeine-app
 * behaviour), so it's an honest, visible "your device won't sleep" guarantee.
 *
 * State is process-global and transient: it defaults to OFF on every launch so
 * the app never silently holds a machine awake across restarts.
 */
let blockerId: number | null = null

export function isWakeMode(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId)
}

/** Turn Wake Mode on/off. Returns the resulting state (the source of truth). */
export function setWakeMode(enabled: boolean): boolean {
  if (enabled) {
    if (!isWakeMode()) blockerId = powerSaveBlocker.start('prevent-display-sleep')
  } else if (blockerId !== null) {
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
  return isWakeMode()
}

/** Release the blocker (called on quit so we never leak it). */
export function stopWakeMode(): void {
  setWakeMode(false)
}
