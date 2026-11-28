// The real app: Electron started as a person starts it, with a profile of its own, on the development copy.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test"

import { LATEST } from "../server/migrate.ts"
import { COPY, bookCopy } from "../server/testing.ts"

const ROOT = resolve(import.meta.dirname, "..")

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const gone = async (pid: number, what: string) => {
  await expect.poll(() => alive(pid), { message: `${what} (pid ${pid}) has ended`, timeout: 10_000 }).toBe(false)
}

/** The app launched, with what it printed and a way to wait for a line of it. */
async function launch() {
  if (!existsSync(join(ROOT, "app/dist/index.html"))) throw new Error("no built page — build it with: pnpm --dir app build")
  const profile = mkdtempSync(join(tmpdir(), "fitz-app-"))
  // a book of its own, as the prototype left it: the app migrates it on opening, as it will the real one
  const book = await bookCopy(join(profile, "book"), "prototype")
  const app = await electron.launch({ args: [ROOT, `--user-data-dir=${profile}`], env: { ...process.env, FITZ_DB: book.path, FITZ_PORT: "0" } })
  let output = ""
  app.process().stdout?.on("data", (d) => { output += d })
  app.process().stderr?.on("data", (d) => { output += d })
  /** Every match of `pattern` printed so far, once there are at least `n`. */
  const printed = async (pattern: RegExp, n = 1) => {
    await expect.poll(() => [...output.matchAll(pattern)].length, { message: `${pattern} printed ${n} time(s)\n${output}`, timeout: 15_000 }).toBeGreaterThanOrEqual(n)
    return [...output.matchAll(pattern)]
  }
  const serverPids = async (n = 1) => (await printed(/\[shell\] server ready pid=(\d+)/g, n)).map((m) => Number(m[1]))
  return { app, pid: app.process().pid!, profile, book, printed, serverPids }
}

let running: { app: ElectronApplication; pid: number; profile: string } | null = null
test.afterEach(async () => {
  if (!running) return
  if (alive(running.pid)) await running.app.close().catch(() => {})
  if (alive(running.pid)) process.kill(running.pid, "SIGKILL")
  rmSync(running.profile, { recursive: true, force: true })
  running = null
})

test("the app opens on the book, as the database holds it", async () => {
  const launched = await launch()
  running = launched
  const page = await launched.app.firstWindow()
  const sql = new DatabaseSync(COPY, { readOnly: true })
  try {
    const count = (query: string) => Number(Object.values(sql.prepare(query).get() ?? {})[0])
    const book = sql.prepare("SELECT title FROM book ORDER BY id LIMIT 1").get()!
    await expect(page).toHaveTitle(String(book.title))
    await expect(page.locator("[data-chapter-id]")).toHaveCount(count("SELECT count(*) FROM chapter"))
    const first = sql.prepare("SELECT id FROM chapter ORDER BY idx LIMIT 1").get()!
    await expect(page.locator("[data-segment-id]")).toHaveCount(count(`SELECT count(*) FROM segment WHERE chapter_id = ${Number(first.id)}`))

    // what the sidebar says of each chapter adds up to the whole book
    const badges = await page.locator("[data-chapter-id] [data-slot=sidebar-menu-badge]").allTextContents()
    const sum = (i: number) => badges.reduce((n, b) => n + Number(b.split("/")[i]), 0)
    expect(sum(1)).toBe(count("SELECT count(*) FROM segment"))
    expect(sum(0)).toBe(count("SELECT count(*) FROM segment WHERE target_doc IS NOT NULL"))
    test.info().annotations.push({ type: "shown", description: `chapters ${badges.length}, paragraphs ${sum(1)}, translated ${sum(0)}` })
  } finally {
    sql.close()
  }
  expect(new URL(page.url()).search, "the token has left the address").toBe("")

  // the book it opened was the prototype's; it is now this app's version, with what it was kept beside it
  const opened = new DatabaseSync(launched.book.path, { readOnly: true })
  try {
    expect(Object.values(opened.prepare("PRAGMA user_version").get() ?? {})[0]).toBe(LATEST)
    expect(Object.values(opened.prepare("PRAGMA journal_mode").get() ?? {})[0]).toBe("wal")
  } finally {
    opened.close()
  }
  expect(readdirSync(join(launched.book.path, "..", "backups"))).toHaveLength(1)
  const shown = await launched.printed(/\[shell\] window shown (\d+) ms after launch/g)
  test.info().annotations.push({ type: "startup", description: `window shown ${shown[0]?.[1]} ms after launch` })
})

test("the window is closed off from Node and from other sites", async () => {
  const launched = await launch()
  running = launched
  const page = await launched.app.firstWindow()
  await expect(page.locator("[data-chapter-id]").first()).toBeVisible()

  const prefs = await launched.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    // not in Electron's types; it is what the window was really made with
    const p = (w?.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> } | undefined)?.getLastWebPreferences()
    return { windows: BrowserWindow.getAllWindows().length, visible: w?.isVisible(), sandbox: p?.sandbox, contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration }
  })
  expect(prefs).toEqual({ windows: 1, visible: true, sandbox: true, contextIsolation: true, nodeIntegration: false })
  expect(await page.evaluate(() => [typeof (globalThis as any).require, typeof (globalThis as any).process])).toEqual(["undefined", "undefined"])

  const here = page.url()
  expect(await page.evaluate(() => window.open("https://example.invalid/") === null)).toBe(true)
  await page.evaluate(() => { location.href = "https://example.invalid/" })
  await page.waitForTimeout(300)
  expect(page.url()).toBe(here)
  expect(await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})

test("a server that dies is started again and the book comes back", async () => {
  const launched = await launch()
  running = launched
  const page = await launched.app.firstWindow()
  await expect(page.locator("[data-chapter-id]").first()).toBeVisible()
  const [first] = await launched.serverPids()
  process.kill(first!, "SIGKILL")
  const [, second] = await launched.serverPids(2)
  expect(second).not.toBe(first)
  await expect(page.locator("[data-segment-id]").first()).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
})

test("quitting the app stops its server", async () => {
  const launched = await launch()
  running = launched
  await launched.app.firstWindow()
  const [server] = await launched.serverPids()
  await launched.app.close()
  await gone(server!, "the server")
  await gone(launched.pid, "the app")
})

test("killing the app outright stops its server too", async () => {
  const launched = await launch()
  running = launched
  await launched.app.firstWindow()
  const [server] = await launched.serverPids()
  process.kill(launched.pid, "SIGKILL")
  await gone(server!, "the server")
})
