// The real app: Electron started as a person starts it, with a profile of its own, on the development copy.
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test"

import { LATEST } from "../server/migrate.ts"
import { PAGES, bookCopy } from "../server/testing.ts"

const ROOT = resolve(import.meta.dirname, "..")

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const gone = async (pid: number, what: string) => {
  await expect.poll(() => alive(pid), { message: `${what} (pid ${pid}) has ended`, timeout: 10_000 }).toBe(false)
}

/** The app launched, with what it printed and a way to wait for a line of it. `again` launches it on the profile
 *  and the book of an earlier launch: the same person opening the app once more. */
async function launch(again?: { profile: string; book: { path: string; backupDir: string } }) {
  if (!existsSync(join(ROOT, "app/dist/index.html"))) throw new Error("no built page — build it with: pnpm --dir app build")
  const profile = again?.profile ?? mkdtempSync(join(tmpdir(), "fitz-app-"))
  // a book of its own, as the prototype left it: the app migrates it on opening, as it will the real one
  const book = again?.book ?? (await bookCopy(join(profile, "book"), "prototype"))
  const app = await electron.launch({ args: [ROOT, `--user-data-dir=${profile}`], env: { ...process.env, FITZ_DB: book.path, FITZ_PAGES_DIR: PAGES, FITZ_PORT: "0" } })
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
  const sql = new DatabaseSync(launched.book.path, { readOnly: true })
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

test("what was saved and what was being typed are both there when the app is opened again, even after it was killed", async () => {
  const first = await launch()
  running = first
  const page = await first.app.firstWindow()
  const sql = new DatabaseSync(first.book.path, { readOnly: true })
  try {
    const rows = sql.prepare("SELECT id, chapter_id FROM segment WHERE target_doc IS NULL ORDER BY chapter_id, idx LIMIT 2").all()
    const [saved, typing] = rows.map((r) => ({ id: Number(r.id), chapterId: Number(r.chapter_id) }))
    const target = (id: number, on = page) => on.locator(`[data-segment-id="${id}"] [data-side=target]`)
    const editor = (id: number, on = page) => on.locator(`[data-segment-id="${id}"] [contenteditable=true]`)
    await page.locator(`[data-chapter-id="${saved!.chapterId}"] button`).click()

    // one translation saved by leaving it…
    await target(saved!.id).click()
    await expect(editor(saved!.id)).toBeFocused()
    await page.keyboard.insertText("앱에서 저장한 번역")
    await page.keyboard.press("Tab")
    await expect.poll(() => sql.prepare("SELECT target_text FROM segment WHERE id = ?").get(saved!.id)?.target_text).toBe("앱에서 저장한 번역")
    // …and the next still being typed when the app dies
    await expect(editor(typing!.id)).toBeFocused()
    await page.keyboard.insertText("치던 중에 앱이 죽었다")
    await expect.poll(() => sql.prepare("SELECT count(*) n FROM draft WHERE segment_id = ?").get(typing!.id)?.n).toBe(1)
    const [server] = await first.serverPids()
    process.kill(first.pid, "SIGKILL")
    await gone(server!, "the server")

    // opened again: another launch, another port, the same book
    const second = await launch({ profile: first.profile, book: first.book })
    running = second
    const reopened = await second.app.firstWindow()
    expect(new URL(reopened.url()).port).not.toBe(new URL(page.url()).port)
    await reopened.locator(`[data-chapter-id="${saved!.chapterId}"] button`).click()
    await expect(target(saved!.id, reopened)).toHaveText("앱에서 저장한 번역")
    await expect(target(typing!.id, reopened)).toHaveText("Not translated")
    const notice = reopened.locator(`[data-segment-id="${typing!.id}"] [data-draft]`)
    await expect(notice).toContainText("Unsaved draft")
    await notice.getByRole("button", { name: "Resume" }).click()
    await expect(editor(typing!.id, reopened)).toBeFocused()
    await expect(editor(typing!.id, reopened)).toHaveText("치던 중에 앱이 죽었다")
    await reopened.keyboard.press("Tab")
    await expect.poll(() => sql.prepare("SELECT target_text FROM segment WHERE id = ?").get(typing!.id)?.target_text).toBe("치던 중에 앱이 죽었다")
    // the book was migrated once, on the first opening; the second found nothing to do
    expect(readdirSync(first.book.backupDir)).toHaveLength(1)

    // ⌘Z in the app takes back that last save, and the one before it, and no more
    await reopened.keyboard.press("Escape")
    await reopened.locator("header").click()
    await reopened.keyboard.press("ControlOrMeta+z")
    await expect(target(typing!.id, reopened)).toHaveText("Not translated")
    await reopened.keyboard.press("ControlOrMeta+z")
    await expect(target(saved!.id, reopened)).toHaveText("Not translated")
    const floor = Number(sql.prepare("SELECT value FROM meta WHERE key = 'undo_floor'").get()?.value)
    await reopened.keyboard.press("ControlOrMeta+z")
    await reopened.waitForTimeout(300)
    expect({ ...sql.prepare("SELECT count(*) n, sum(undone) undone FROM ops WHERE id <= ?").get(floor) }).toEqual({ n: floor, undone: 0 })
  } finally {
    sql.close()
  }
})
