// The shell: one window, and the server it starts and stops. It holds none of the book — the page asks the server.
//
// The window is closed off from Node and from everything but this app's own server: sandboxed, no preload (the page
// needs nothing of the shell yet), no navigation elsewhere, no new windows, no permissions.
import { randomBytes } from "node:crypto"
import { enableCompileCache } from "node:module"
import { dirname, join, resolve } from "node:path"

import { BrowserWindow, app, dialog, nativeTheme, session, shell } from "electron"

import { createServerProcess, type RunningServer } from "./server-process.ts"

// compiled code is kept between launches, so the next one starts faster
enableCompileCache()

const ROOT = resolve(import.meta.dirname, "..")
/** A server that keeps crashing is not started again: this many times within the window is the end. */
const RESTARTS = 3
const RESTART_WINDOW_MS = 5 * 60_000

let win: BrowserWindow | null = null
let quitting = false
const crashes: number[] = []

/** Say why the app cannot go on, and end it. */
function fatal(title: string, words: string[]): void {
  console.error(`[shell] ${title}\n${words.join("\n")}`)
  dialog.showErrorBox(title, words.join("\n"))
  app.exit(1)
}

const dbPath = process.env.FITZ_DB ?? join(ROOT, "dev-data/out/book.db")
const server = createServerProcess({
  entry: join(ROOT, "server/main.ts"),
  config: {
    port: Number(process.env.FITZ_PORT ?? 0),
    // new on every launch; it goes to the server over the IPC channel, never in the environment or the arguments
    token: randomBytes(32).toString("base64url"),
    dbPath,
    backupDir: join(dirname(dbPath), "backups"),
    // the scanned pages sit beside the book, as the import left them
    pagesDir: process.env.FITZ_PAGES_DIR ?? join(dirname(dbPath), "pages"),
    clientDir: join(ROOT, "app/dist"),
  },
  onCrash(words) {
    if (quitting) return
    const now = Date.now()
    crashes.push(now)
    while (crashes[0] !== undefined && now - crashes[0] > RESTART_WINDOW_MS) crashes.shift()
    if (crashes.length >= RESTARTS) return fatal("fitz's server keeps stopping", words)
    console.error(`[shell] the server stopped; starting it again (${crashes.length} of ${RESTARTS - 1})`)
    server.start().then(open, (e: Error) => fatal("fitz's server could not be started again", [e.message]))
  },
})

/** Point the window at the server. The page keeps nothing the server does not hold, so a restart is a reload. */
function open(running: RunningServer): void {
  console.log(`[shell] server ready pid=${running.pid} port=${running.port}`)
  win?.loadURL(running.door).catch((e: Error) => console.error(`[shell] the page could not be loaded: ${e.message}`))
}

function createWindow(running: RunningServer): BrowserWindow {
  const origin = new URL(running.url).origin
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    // shown once the page has drawn, over the page's own background: no white flash
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  window.once("ready-to-show", () => {
    window.show()
    console.log(`[shell] window shown ${Math.round(process.uptime() * 1000)} ms after launch`)
  })
  // the window is this app's page and nothing else: links to the web open in the person's browser
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url)
    return { action: "deny" }
  })
  window.on("closed", () => { win = null })
  return window
}

if (!app.requestSingleInstanceLock()) {
  // one fitz at a time, on one book: this launch brings the running one forward and ends — said, so that a run that
  // shows an older window is not taken for this code
  console.log("[shell] fitz is already running: its window was brought forward and this launch ends. Quit it (⌘Q) to start this one.")
  app.quit()
} else {
  // the server starts at once, beside Electron's own startup
  const starting = server.start()
  starting.catch(() => {}) // heard below, once the app can show why

  app.on("second-instance", () => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  app.on("window-all-closed", () => app.quit())
  // the server is stopped before the app leaves; were the shell killed instead, the server ends itself (server/main.ts)
  app.on("before-quit", (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void server.stop().finally(() => app.quit())
  })
  process.on("SIGTERM", () => app.quit())
  process.on("SIGINT", () => app.quit())

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, allow) => allow(false))
    try {
      const running = await starting
      win = createWindow(running)
      open(running)
    } catch (e) {
      fatal("fitz could not open the book", [e instanceof Error ? e.message : String(e)])
    }
  })
}
