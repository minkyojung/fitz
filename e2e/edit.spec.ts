// Editing a translation in the browser, checked against the book the server holds.
import type { DatabaseSync } from "node:sqlite"

import type { Page } from "@playwright/test"

import { expect, test } from "./server.ts"

const one = (sql: DatabaseSync, query: string, ...params: number[]) => Object.values(sql.prepare(query).get(...params) ?? {})[0]
const row = (sql: DatabaseSync, id: number) => ({ ...sql.prepare("SELECT target_text, target_doc, status, version FROM segment WHERE id = ?").get(id) })
const ops = (sql: DatabaseSync) => Number(one(sql, "SELECT count(*) FROM ops"))
/** The first paragraph with no translation, and the next in its chapter. */
const untranslated = (sql: DatabaseSync) => {
  const s = sql.prepare("SELECT id, chapter_id, idx FROM segment WHERE target_doc IS NULL ORDER BY chapter_id, idx LIMIT 1").get()!
  const next = sql.prepare("SELECT id FROM segment WHERE chapter_id = ? AND idx = ?").get(Number(s.chapter_id), Number(s.idx) + 1)
  return { id: Number(s.id), chapterId: Number(s.chapter_id), nextId: next ? Number(next.id) : null }
}
/** The page open on a chapter; returns the paragraph's row and its translation side. */
async function open(page: Page, door: string, chapterId: number, segmentId: number) {
  await page.goto(door)
  await page.locator(`[data-chapter-id="${chapterId}"] button`).click()
  const pair = page.locator(`[data-segment-id="${segmentId}"]`)
  await expect(pair).toBeVisible()
  const target = pair.locator("[data-side=target]")
  const editor = pair.locator("[contenteditable=true]")
  /** Click the translation and wait for the editor to take the keys: it opens within a frame of the click. */
  const edit = async (options?: Parameters<typeof target.click>[0]) => {
    await target.click(options)
    await expect(editor).toBeFocused()
  }
  return { pair, target, editor, edit }
}

test("a translation typed and left with Tab is saved, and the next paragraph opens", async ({ page, door, sql }) => {
  const { id, chapterId, nextId } = untranslated(sql)
  const before = { ops: ops(sql), badge: await (async () => { await page.goto(door); return page.locator(`[data-chapter-id="${chapterId}"] [data-slot=sidebar-menu-badge]`).textContent() })() }
  const { pair, target, edit } = await open(page, door, chapterId, id)
  await edit()
  await page.keyboard.insertText("새로 옮긴 문장입니다.")
  await page.keyboard.press("Tab")

  await expect(target).toHaveAttribute("data-translated", "true")
  await expect(target).toHaveText("새로 옮긴 문장입니다.")
  await expect(pair).toHaveAttribute("data-status", "draft")
  await expect.poll(() => row(sql, id).target_text).toBe("새로 옮긴 문장입니다.")
  expect(row(sql, id).status).toBe("draft")
  expect(ops(sql)).toBe(before.ops + 1)
  expect({ ...sql.prepare("SELECT name, actor FROM ops ORDER BY id DESC LIMIT 1").get() }).toEqual({ name: "updateSegment", actor: "translator" })
  // the chapter's count in the sidebar follows
  const [done, total] = before.badge!.split("/").map(Number)
  await expect(page.locator(`[data-chapter-id="${chapterId}"] [data-slot=sidebar-menu-badge]`)).toHaveText(`${done! + 1}/${total}`)
  // Tab went on to the next paragraph
  if (nextId !== null) await expect(page.locator(`[data-segment-id="${nextId}"] [contenteditable=true]`)).toBeFocused()

  // it is in the book, not only on the screen
  await page.keyboard.press("Escape")
  await page.reload()
  await page.locator(`[data-chapter-id="${chapterId}"] button`).click()
  await expect(page.locator(`[data-segment-id="${id}"] [data-side=target]`)).toHaveText("새로 옮긴 문장입니다.")
})

test("Escape leaves the paragraph as it was; leaving without a change logs nothing", async ({ page, door, sql }) => {
  const { id, chapterId } = untranslated(sql)
  const before = { ops: ops(sql), row: row(sql, id) }
  const { target, editor, edit } = await open(page, door, chapterId, id)
  await edit()
  await page.keyboard.insertText("버릴 문장")
  await page.keyboard.press("Escape")
  await expect(editor).toHaveCount(0)
  await expect(target).toHaveText("Not translated")

  await edit()
  await page.keyboard.press("Shift+Tab")
  await expect(editor).toHaveCount(0)
  await page.keyboard.press("Escape")
  await page.locator("header").click()
  await page.waitForTimeout(200)
  expect(row(sql, id)).toEqual(before.row)
  expect(ops(sql)).toBe(before.ops)
})

test("Enter makes a new paragraph inside the translation; ⌘Enter saves it as reviewed and moves on", async ({ page, door, sql }) => {
  const { id, chapterId, nextId } = untranslated(sql)
  const { pair, target, edit } = await open(page, door, chapterId, id)
  await edit()
  await page.keyboard.insertText("첫 문단")
  await page.keyboard.press("Enter")
  await page.keyboard.insertText("둘째 문단")
  await page.keyboard.press("ControlOrMeta+Enter")

  await expect(pair).toHaveAttribute("data-status", "reviewed")
  await expect(target.locator("p")).toHaveText(["첫 문단", "둘째 문단"])
  await expect.poll(() => row(sql, id).target_text).toBe("첫 문단\n둘째 문단")
  expect(JSON.parse(String(row(sql, id).target_doc)).content).toHaveLength(2)
  expect(row(sql, id).status).toBe("reviewed")
  if (nextId !== null) await expect(page.locator(`[data-segment-id="${nextId}"] [contenteditable=true]`)).toBeFocused()
})

test("a click puts the caret where it landed; clicking elsewhere saves", async ({ page, door, sql }) => {
  const s = sql.prepare("SELECT id, chapter_id, target_text FROM segment WHERE target_doc IS NOT NULL AND length(target_text) > 40 ORDER BY id LIMIT 1").get()!
  const { target, editor, edit } = await open(page, door, Number(s.chapter_id), Number(s.id))
  await edit({ position: { x: 1, y: 6 } })
  await page.keyboard.insertText("【앞】")
  await page.locator("header").click()
  await expect(editor).toHaveCount(0)
  await expect.poll(() => row(sql, Number(s.id)).target_text).toBe(`【앞】${s.target_text}`)
  await expect(target).toHaveText(`【앞】${String(s.target_text).replaceAll("\n", "")}`)
})

test("⌘Z inside the editor takes back typing only", async ({ page, door, sql }) => {
  const { id, chapterId } = untranslated(sql)
  const before = { ops: ops(sql), undone: Number(one(sql, "SELECT count(*) FROM ops WHERE undone = 1")) }
  let asked = 0
  page.on("request", (r) => { if (/\/api\/(undo|redo)$/.test(r.url())) asked++ })
  const { editor, edit } = await open(page, door, chapterId, id)
  await edit()
  await page.keyboard.type("abc")
  await expect(editor).toHaveText("abc")
  await page.keyboard.press("ControlOrMeta+z")
  await expect(editor).not.toHaveText("abc")
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect(editor).toHaveText("abc")
  await page.keyboard.press("Escape")
  expect(asked).toBe(0)
  expect({ ops: ops(sql), undone: Number(one(sql, "SELECT count(*) FROM ops WHERE undone = 1")) }).toEqual(before)
})

test("Korean typed through an input method arrives whole", async ({ page, door, sql }) => {
  const { id, chapterId } = untranslated(sql)
  const { target, editor, edit } = await open(page, door, chapterId, id)
  await edit()
  const ime = await page.context().newCDPSession(page)
  // 한 as an input method builds it: ㅎ → 하 → 한, each replacing the last, then committed
  for (const text of ["ㅎ", "하", "한"]) await ime.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length })
  await ime.send("Input.insertText", { text: "한" })
  for (const text of ["ㄱ", "그", "글"]) await ime.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length })
  // left while 글 is still being composed: what is on screen is what is saved
  await expect(editor).toHaveText("한글")
  await page.keyboard.press("Tab")
  await expect(target).toHaveText("한글")
  await expect.poll(() => row(sql, id).target_text).toBe("한글")
})
