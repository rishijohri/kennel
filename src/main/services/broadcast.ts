import type { BrowserWindow } from 'electron'
import type {
  CaretakerEvent,
  DownloadProgress,
  KennelState,
  LocalServerStatus,
  RunEvent,
  UpdateState,
  WalkerEvent
} from '@shared/types'

let win: BrowserWindow | null = null

export function setMainWindow(w: BrowserWindow): void {
  win = w
}

/** Safe send: the window (or its webContents) may be destroyed during quit. */
function send(channel: string, payload: unknown): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, payload)
}

export function sendRunEvent(e: RunEvent): void {
  send('kennel:run-event', e)
}

export function sendState(s: KennelState): void {
  send('kennel:state-changed', s)
}

export function sendLocalStatus(s: LocalServerStatus): void {
  send('kennel:local-status', s)
}

export function sendCaretakerEvent(e: CaretakerEvent): void {
  send('kennel:caretaker-event', e)
}

export function sendWalkerEvent(e: WalkerEvent): void {
  send('kennel:walker-event', e)
}

export function sendDownloadProgress(p: DownloadProgress): void {
  send('kennel:download-progress', p)
}

export function sendUpdateEvent(s: UpdateState): void {
  send('kennel:update-event', s)
}
