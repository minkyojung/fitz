// The book's own undo and redo, from the keyboard, checked against the book the server holds.
import type { DatabaseSync } from "node:sqlite"

import type { Page } from "@playwright/test"

import { expect, test } from "./server.ts"

const one = (sql: DatabaseSync, query: string, ...params: number[]) => Object.values(sql.prepare(query).get(...params) ?? {})[0]
const row = (sql: DatabaseSync, id: number) => ({ ...sql.prepare("SELECT target_text, target_doc, status, version FROM segment WHERE id = ?").get(id) })
const untranslated = (sql: DatabaseSync) => {
  const s = sql.prepare("SELECT id, chapter_id FROM segment WHERE target_doc IS NULL ORDER BY chapter_id, idx LIMIT 1").get()!
  return { id: Number(s.id), chapterId: Number(s.chapter_id) }
}
async function open(page: Page, door: string, chapterId: number, segmentId: number) {
  await page.goto(door)
  await page.locator(`[data-chapter-id="${chapterId}"] button`).click()
  const pair = page.locator(`[data-segment-id="${segmentId}"]`)
  const target = pair.locator("[data-side=target]")
  const editor = pair.locator("[contenteditable=true]")
  const edit = async () => {
    await target.click()
    await expect(editor).toBeFocused()
  }
  return { target, edit }
}

test("⌘Z outside the editor takes back the last save and ⌘⇧Z does it again; nothing older is taken back", async ({ page, door, sql }) => {
  const floor = Number(one(sql, "SELECT value FROM meta WHERE key = 'undo_floor'"))
  const old = () => ({ ...sql.prepare("SELECT count(*) n, sum(undone) undone FROM ops WHERE id <= ?").get(floor) })
  expect(old()).toEqual({ n: floor, undone: 0 })
  // take back whatever earlier tests left standing, so this test starts from the floor
  await page.goto(door)
  await page.locator("header").click()
  // (all of them, one ⌘Z each: the tests before this one, on the same server, may have left any number)
  const standing = () => Number(one(sql, `SELECT count(*) FROM ops WHERE id > ${floor} AND undone = 0`))
  for (let left = standing(); left > 0; left--) {
    await page.keyboard.press("ControlOrMeta+z")
    await expect.poll(standing).toBe(left - 1)
  }

  const { id, chapterId } = untranslated(sql)
  const { target, edit } = await open(page, door, chapterId, id)
  await edit()
  await page.keyboard.insertText("되돌릴 문장")
  await page.locator("header").click()
  await expect.poll(() => row(sql, id).target_text).toBe("되돌릴 문장")

  await page.keyboard.press("ControlOrMeta+z")
  await expect(target).toHaveText("Not translated")
  expect(row(sql, id).target_text).toBe(null)
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect(target).toHaveText("되돌릴 문장")
  expect(row(sql, id).target_text).toBe("되돌릴 문장")

  await page.keyboard.press("ControlOrMeta+z")
  await expect(target).toHaveText("Not translated")
  // nothing of this app's is left standing: one more ⌘Z must not reach the prototype's changes
  const everything = () => JSON.stringify(sql.prepare("SELECT id, version, target_text, status FROM segment ORDER BY id").all())
  const before = everything()
  await page.keyboard.press("ControlOrMeta+z")
  await page.waitForTimeout(300)
  expect(everything()).toBe(before)
  expect(old()).toEqual({ n: floor, undone: 0 })
})

