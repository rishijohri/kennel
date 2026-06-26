import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'
import { setMainWindow } from './services/broadcast'
import { stopServer } from './services/local-llm'
import { startScheduler, stopScheduler } from './services/scheduler'
import { disconnectMcp } from './services/mcp'
import { stopWakeMode } from './services/wake'

// The macOS application menu's bold first item is taken from app.name, which
// otherwise defaults to package.json's lowercase "kennel". Set it before the app
// reads any name-derived path (userData, menu) so the brand shows everywhere.
app.setName('Kennel')

/** Full-resolution brand icon (source art). Present in dev; packaged builds use the bundled .icns. */
const APP_ICON = join(app.getAppPath(), 'assets', 'app_main_icon.png')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0b10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    title: 'Kennel',
    // macOS uses the bundle icon; Windows/Linux take the window icon directly.
    ...(process.platform !== 'darwin' && existsSync(APP_ICON) ? { icon: APP_ICON } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  setMainWindow(win)

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Show the brand icon on the macOS dock in dev (packaged builds use the .icns).
  if (process.platform === 'darwin' && !app.isPackaged && app.dock && existsSync(APP_ICON)) {
    app.dock.setIcon(APP_ICON)
  }
  registerIpc()
  createWindow()
  startScheduler()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  stopScheduler()
  stopWakeMode()
  void stopServer()
  void disconnectMcp()
})
