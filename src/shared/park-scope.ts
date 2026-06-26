/**
 * Cross-park sharing of park-scoped personas/processes.
 *
 * Park capabilities (scope:'park') belong to a project. By default they are
 * SHARED across all of the project's Parks. A project can disable sharing
 * (`Project.shareParkCapabilities === false`), isolating each Park to the
 * capabilities it owns (`ownerParkId === parkId`). Unowned legacy capabilities
 * and the built-in "summarize-report" report writer always stay visible.
 */
export interface ParkScopedItem {
  scope?: 'canvas' | 'park'
  ownerParkId?: string
  builtin?: string
}

/** True if a park-scoped `item` should be visible/usable inside `parkId`. */
export function parkCapVisible(
  item: ParkScopedItem,
  parkId: string | undefined,
  shared: boolean
): boolean {
  if (item.scope !== 'park') return false
  if (shared) return true
  if (item.builtin === 'summarize-report') return true
  // Unowned (legacy) caps remain shared; owned caps only appear in their owner Park.
  return !item.ownerParkId || item.ownerParkId === parkId
}
