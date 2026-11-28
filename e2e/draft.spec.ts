// What is being typed is not lost: not by reloading mid-edit, not by a save the server refuses.
import type { DatabaseSync } from "node:sqlite"

import type { Page } from "@playwright/test"

import { expect, test } from "./server.ts"

const row = (sql: DatabaseSync, id: number) => ({ ...sql.prepare("SELECT target_text, status, version FROM segment WHERE id = ?").get(id) })
const draftOf = (sql: DatabaseSync, id: number) => { const d = sql.prepare("SELECT doc FROM draft WHERE segment_id = ? AND side = 'target'").get(id); return d ? JSON.parse(String(d.doc)).content.map((p: { content?: { text: string }[] }) => (p.content ?? []).map((n) => n.text).join("")).join("\n") : null }
const drafts = (sql: DatabaseSync) => Number(Object.values(sql.prepare("SELECT count(*) FROM draft").get() ?? {})[0])
const untranslated = (sql: DatabaseSync) => {
  const s = sql.prepare("SELECT id, chapter_id FROM segment WHERE target_doc IS NULL AND id NOT IN (SELECT segment_id FROM draft) ORDER BY chapter_id, idx LIMIT 1").get()!
  return { id: Number(s.id), chapterId: Number(s.chapter_id) }
}
async function open(page: Page, door: string, chapterId: number, segmentId: number) {
  await page.goto(door)
  await page.locator(`[data-chapter-id="${chapterId}"] button`).click()
  const pair = page.locator(`[data-segment-id="${segmentId}"]`)
  await expect(pair).toBeVisible()
  const target = pair.locator("[data-side=target]")
  const editor = pair.locator("[contenteditable=true]")
  const edit = async () => {
    await target.click()
    await expect(editor).toBeFocused()
  }
  return { pair, target, editor, edit, notice: pair.locator("[data-draft]") }
}

test("text typed and never left survives a reload as a draft, and is saved once resumed and left", async ({ page, door, sql }) => {
  const { id, chapterId } = untranslated(sql)
  const first = await open(page, door, chapterId, id)
  await first.edit()
  await page.keyboard.insertText("치다가 만 문장")
  await expect.poll(() => draftOf(sql, id)).toBe("치다가 만 문장")
  expect(row(sql, id).target_text, "a draft is not a save").toBe(null)

  // the page goes away without the edit being left: a crash, as far as the book knows
  const { target, editor, notice } = await open(page, door, chapterId, id)
  await expect(target).toHaveText("Not translated")
  await expect(notice).toContainText("Unsaved draft")
  await expect(notice).not.toContainText("changed since")
  await notice.getByRole("button", { name: "Resume" }).click()
  await expect(editor).toBeFocused()
  await expect(editor).toHaveText("치다가 만 문장")
  await page.keyboard.insertText(" 그리고 마저 친 말")
  await page.keyboard.press("Tab")
  await expect.poll(() => row(sql, id).target_text).toBe("치다가 만 문장 그리고 마저 친 말")
  await expect(target).toHaveText("치다가 만 문장 그리고 마저 친 말")
  await expect(notice).toHaveCount(0)
  await expect.poll(() => draftOf(sql, id)).toBe(null)
})

test("a click on a paragraph with a draft opens the draft; Discard drops it", async ({ page, door, sql, api }) => {
  const { id, chapterId } = untranslated(sql)
  const typed = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "남아 있던 초안" }] }] }
  expect((await api("saveDraft", { segmentId: id, side: "target", doc: typed, baseVersion: Number(row(sql, id).version) })).status).toBe(200)
  const { target, editor, edit, notice } = await open(page, door, chapterId, id)
  await expect(notice).toContainText("Unsaved draft")
  await edit()
  await expect(editor).toHaveText("남아 있던 초안")
  // the page goes away again; the draft is still there
  const again = await open(page, door, chapterId, id)
  await again.notice.getByRole("button", { name: "Discard" }).click()
  await expect(again.notice).toHaveCount(0)
  await expect.poll(() => draftOf(sql, id)).toBe(null)
  expect(row(sql, id).target_text).toBe(null)
  await expect(target).toHaveCount(1)
})

test("Escape and a save both leave no draft behind, however fast the edit was left", async ({ page, door, sql }) => {
  const { id, chapterId } = untranslated(sql)
  const { target, edit } = await open(page, door, chapterId, id)
  await edit()
  await page.keyboard.insertText("버릴 글")
  await expect.poll(() => draftOf(sql, id)).toBe("버릴 글")
  await page.keyboard.press("Escape")
  await expect.poll(() => draftOf(sql, id)).toBe(null)
  await expect(target).toHaveText("Not translated")

  // typed and left at once, before the draft would have been written: no draft may land after the save
  await edit()
  await page.keyboard.insertText("곧바로 저장")
  await page.keyboard.press("Tab")
  await expect.poll(() => row(sql, id).target_text).toBe("곧바로 저장")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(700)
  expect(drafts(sql)).toBe(0)
})

test("a draft still on its way when the edit is left does not land after the save", async ({ page, door, sql }) => {
  const { id, chapterId } = untranslated(sql)
  const { edit } = await open(page, door, chapterId, id)
  // the draft takes its time getting to the server
  await page.route("**/api/saveDraft", async (route) => {
    await new Promise((done) => setTimeout(done, 400))
    await route.continue()
  })
  await edit()
  await page.keyboard.insertText("느린 초안, 빠른 저장")
  await page.waitForRequest("**/api/saveDraft")
  await page.keyboard.press("Tab")
  await expect.poll(() => row(sql, id).target_text).toBe("느린 초안, 빠른 저장")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(900)
  expect(draftOf(sql, id), "the save waited for the draft, and took its place").toBe(null)
})

test("a save the server refuses loses nothing: the other writer's text shows, mine is kept as a draft", async ({ page, door, sql, api, complaints }) => {
  const s = sql.prepare("SELECT id, chapter_id, version FROM segment WHERE target_doc IS NOT NULL AND id NOT IN (SELECT segment_id FROM draft) ORDER BY id DESC LIMIT 1").get()!
  const id = Number(s.id)
  const { target, editor, edit, notice } = await open(page, door, Number(s.chapter_id), id)
  await edit()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.insertText("내가 고친 번역")
  // meanwhile another writer changes the same paragraph
  const theirs = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "다른 쪽이 고친 번역" }] }] }
  expect((await api("updateSegment", { id, patch: { targetDoc: theirs }, expectVersion: Number(s.version) })).status).toBe(200)

  await page.locator("header").click()
  const toast = page.locator("[data-sonner-toast]")
  await expect(toast).toContainText("not saved")
  await expect(toast).toContainText("changed since it was read")
  await expect(target).toHaveText("다른 쪽이 고친 번역")
  expect(row(sql, id).target_text).toBe("다른 쪽이 고친 번역")
  await expect(notice).toContainText("the paragraph changed since")
  expect(draftOf(sql, id)).toBe("내가 고친 번역")

  // resumed, the edit starts from the paragraph as it is now, so this save goes through
  await notice.getByRole("button", { name: "Resume" }).click()
  await expect(editor).toBeFocused()
  await expect(editor).toHaveText("내가 고친 번역")
  await page.keyboard.press("Tab")
  await expect.poll(() => row(sql, id).target_text).toBe("내가 고친 번역")
  await expect.poll(() => draftOf(sql, id)).toBe(null)
  complaints.length = 0 // the refused save is the point of this test
})
