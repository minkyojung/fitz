// The review screen: the scan beside the paragraphs, always on the same page. Checked against the book the server holds.
import type { DatabaseSync } from "node:sqlite"

import type { Page } from "@playwright/test"

import { expect, test } from "./server.ts"

type Row = { id: number; chapterId: number; pageStart: number; pageEnd: number }
const segments = (sql: DatabaseSync, chapterId: number): Row[] =>
  sql.prepare("SELECT id, chapter_id chapterId, page_start pageStart, page_end pageEnd FROM segment WHERE chapter_id = ? ORDER BY idx").all(chapterId).map((r) => ({ ...r }) as Row)
const chapters = (sql: DatabaseSync) => sql.prepare("SELECT id, title, start_page startPage FROM chapter ORDER BY idx").all().map((r) => ({ id: Number(r.id), title: String(r.title), startPage: Number(r.startPage) }))

/** The app on the review stage, on a chapter. */
async function review(page: Page, door: string, chapterId?: number) {
  await page.goto(door)
  await page.locator("[data-stage=review] button").click()
  if (chapterId !== undefined) await page.locator(`[data-chapter-id="${chapterId}"] button`).click()
  const scan = page.locator("[data-scan]")
  await expect(scan).toBeVisible()
  return {
    scan,
    shown: scan.locator("[data-page-no]"),
    picture: scan.locator("img"),
    box: scan.locator("[data-box]"),
    selected: page.locator("[data-segment-id][data-selected=true]"),
    notice: page.locator("[data-empty-page]"),
  }
}

test("the review stage counts what is checked against the scan; translate counts what is translated", async ({ page, door, sql }) => {
  await page.goto(door)
  await expect(page.locator("[data-stage=translate] button")).toHaveAttribute("aria-current", "true")
  const counts = (column: string) => sql.prepare(`SELECT sum(${column}) d, count(*) n FROM segment GROUP BY chapter_id ORDER BY (SELECT idx FROM chapter WHERE id = chapter_id)`).all().map((r) => `${r.d}/${r.n}`)
  const badges = page.locator("[data-chapter-id] [data-slot=sidebar-menu-badge]")
  await expect(badges).toHaveText(counts("target_doc IS NOT NULL"))
  await page.locator("[data-stage=review] button").click()
  await expect(page.locator("[data-stage=review] button")).toHaveAttribute("aria-current", "true")
  await expect(badges).toHaveText(counts("verified"))
  await expect(page.locator("[data-scan]")).toBeVisible()
  await page.locator("[data-stage=translate] button").click()
  await expect(page.locator("[data-scan]")).toHaveCount(0)
  await expect(page.locator("[data-segment-id] [data-side=target]").first()).toBeVisible()
})

test("the first paragraph is chosen and the scan shows its page, with its box drawn on the picture", async ({ page, door, sql }) => {
  const [first] = chapters(sql)
  const [s] = segments(sql, first!.id)
  const { shown, picture, box, selected } = await review(page, door, first!.id)
  await expect(selected).toHaveAttribute("data-segment-id", String(s!.id))
  await expect(shown).toHaveAttribute("data-page-no", String(s!.pageStart))
  await expect(shown).toHaveText(`p. ${s!.pageStart}`)
  await expect(picture).toHaveAttribute("alt", `Book page ${s!.pageStart}`)
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)
  // the box is where the database says, on the picture
  const want = sql.prepare("SELECT x0, y0, x1, y1 FROM segment_box WHERE segment_id = ? AND page_no = ?").get(s!.id, s!.pageStart)!
  const img = (await picture.boundingBox())!
  const drawn = (await box.boundingBox())!
  expect(Math.abs(drawn.x - (img.x + Number(want.x0) * img.width))).toBeLessThan(2)
  expect(Math.abs(drawn.y - (img.y + Number(want.y0) * img.height))).toBeLessThan(2)
  expect(Math.abs(drawn.width - (Number(want.x1) - Number(want.x0)) * img.width)).toBeLessThan(3)
  expect(Math.abs(drawn.height - (Number(want.y1) - Number(want.y0)) * img.height)).toBeLessThan(3)
})

test("↓ and ↑ choose the next and previous paragraph, and the scan follows", async ({ page, door, sql }) => {
  const chapter = chapters(sql).find((c) => new Set(segments(sql, c.id).map((s) => s.pageStart)).size > 1)!
  const rows = segments(sql, chapter.id)
  const turn = rows.findIndex((s, i) => i > 0 && s.pageStart !== rows[i - 1]!.pageStart)
  const { shown, selected } = await review(page, door, chapter.id)
  for (let i = 0; i < turn; i++) await page.keyboard.press("ArrowDown")
  await expect(selected).toHaveAttribute("data-segment-id", String(rows[turn]!.id))
  await expect(shown).toHaveAttribute("data-page-no", String(rows[turn]!.pageStart))
  await page.keyboard.press("k")
  await expect(selected).toHaveAttribute("data-segment-id", String(rows[turn - 1]!.id))
  await page.keyboard.press("j")
  await expect(selected).toHaveAttribute("data-segment-id", String(rows[turn]!.id))
  // a click chooses too
  await page.locator(`[data-segment-id="${rows[0]!.id}"]`).click()
  await expect(selected).toHaveAttribute("data-segment-id", String(rows[0]!.id))
  await expect(shown).toHaveAttribute("data-page-no", String(rows[0]!.pageStart))
  await page.keyboard.press("ArrowUp")
  await expect(selected).toHaveAttribute("data-segment-id", String(rows[0]!.id), { timeout: 1000 })
})

test("turning the page chooses its first paragraph; past the chapter's end the chapter changes; an empty page says so", async ({ page, door, sql }) => {
  const [prologue, next] = chapters(sql)
  const rows = segments(sql, prologue!.id)
  const { scan, shown, selected, notice } = await review(page, door, prologue!.id)
  const nextButton = scan.getByRole("button", { name: "Next page" })
  // to the first page whose first paragraph starts there, one after another
  const last = rows.at(-1)!
  while (Number(await shown.getAttribute("data-page-no")) < last.pageEnd) {
    await nextButton.click()
    const n = Number(await shown.getAttribute("data-page-no"))
    const on = rows.find((s) => s.pageStart <= n && n <= s.pageEnd)
    await expect(selected).toHaveAttribute("data-segment-id", String(on!.id))
  }
  // the pages after the chapter's last paragraph and before the next chapter are the chapter's, with nothing on them
  await nextButton.click()
  await expect(shown).toHaveAttribute("data-page-no", String(last.pageEnd + 1))
  await expect(notice).toHaveText(`p. ${last.pageEnd + 1} · No paragraphs on this page.`)
  await expect(selected).toHaveCount(0)
  await expect(page.locator("[data-slot=breadcrumb-page]")).toHaveText(prologue!.title)
  while (Number(await shown.getAttribute("data-page-no")) < next!.startPage - 1) await nextButton.click()
  // over the edge: the next chapter, on its first page
  await nextButton.click()
  await expect(page.locator("[data-slot=breadcrumb-page]")).toHaveText(next!.title)
  await expect(page.locator(`[data-chapter-id="${next!.id}"] button`)).toHaveAttribute("aria-current", "true")
  await expect(shown).toHaveAttribute("data-page-no", String(next!.startPage))
  await expect(selected).toHaveAttribute("data-segment-id", String(segments(sql, next!.id)[0]!.id))
  await expect(notice).toHaveCount(0)
  // and back over it
  await scan.getByRole("button", { name: "Previous page" }).click()
  await expect(page.locator("[data-slot=breadcrumb-page]")).toHaveText(prologue!.title)
  await expect(shown).toHaveAttribute("data-page-no", String(next!.startPage - 1))
  await expect(notice).toBeVisible()
})

test("the pages before the first chapter can be looked at; the first page cannot be turned back", async ({ page, door, sql }) => {
  const [prologue] = chapters(sql)
  const { scan, shown, notice } = await review(page, door, prologue!.id)
  const previous = scan.getByRole("button", { name: "Previous page" })
  const first = Number(sql.prepare("SELECT page_no FROM page ORDER BY pdf_index LIMIT 1").get()!.page_no)
  await previous.click()
  await expect(shown).toHaveAttribute("data-page-no", String(prologue!.startPage - 1))
  await expect(notice).toBeVisible()
  await expect(page.locator("[data-slot=breadcrumb-page]")).toHaveText(prologue!.title)
  while (await previous.isEnabled()) await previous.click()
  await expect(shown).toHaveAttribute("data-page-no", String(first))
})

test("⌘I hides the scan and shows it again", async ({ page, door }) => {
  const { scan } = await review(page, door)
  await page.locator("header").click()
  await page.keyboard.press("ControlOrMeta+i")
  await expect(scan).toBeHidden()
  await page.keyboard.press("ControlOrMeta+i")
  await expect(scan).toBeVisible()
})

// ---- fixing what the scan shows is wrong

const rowOf = (sql: DatabaseSync, id: number) => ({ ...sql.prepare("SELECT source_text, source_doc, ocr_text, kind, verified, version FROM segment WHERE id = ?").get(id) })
const sourceDraft = (sql: DatabaseSync, id: number) => sql.prepare("SELECT doc FROM draft WHERE segment_id = ? AND side = 'source'").get(id)?.doc ?? null
/** A chapter with a few paragraphs, none verified and none with a source draft: the edits of one test do not meet another's. */
const fresh = (sql: DatabaseSync, after = 0) => {
  const c = sql.prepare(
    `SELECT chapter_id id FROM segment GROUP BY chapter_id HAVING count(*) >= 4 AND sum(verified) = 0
       AND chapter_id NOT IN (SELECT s.chapter_id FROM draft d JOIN segment s ON s.id = d.segment_id)
     ORDER BY chapter_id LIMIT 1 OFFSET ?`,
  ).get(after)!
  return { chapterId: Number(c.id), rows: segments(sql, Number(c.id)) }
}

test("a paragraph is verified with its checkbox or Space; the chapter's count follows; ⌘Z takes it back", async ({ page, door, sql }) => {
  const { chapterId, rows } = fresh(sql)
  const { selected } = await review(page, door, chapterId)
  const badge = page.locator(`[data-chapter-id="${chapterId}"] [data-slot=sidebar-menu-badge]`)
  await expect(badge).toHaveText(`0/${rows.length}`)
  const first = page.locator(`[data-segment-id="${rows[0]!.id}"]`)
  await first.getByRole("checkbox", { name: "Verified" }).click()
  await expect.poll(() => rowOf(sql, rows[0]!.id).verified).toBe(1)
  await expect(badge).toHaveText(`1/${rows.length}`)
  await expect(first).toHaveAttribute("data-verified", "true")

  // the keys: ↓ to the next, Space to verify it — three in a row
  await page.locator("header").click()
  for (const row of rows.slice(1, 4)) {
    await page.keyboard.press("ArrowDown")
    await expect(selected).toHaveAttribute("data-segment-id", String(row.id))
    await page.keyboard.press(" ")
    await expect.poll(() => rowOf(sql, row.id).verified).toBe(1)
  }
  await expect(badge).toHaveText(`4/${rows.length}`)
  await page.keyboard.press("ControlOrMeta+z")
  await expect.poll(() => rowOf(sql, rows[3]!.id).verified).toBe(0)
  await expect(badge).toHaveText(`3/${rows.length}`)
  await expect(page.locator(`[data-segment-id="${rows[3]!.id}"]`)).toHaveAttribute("data-verified", "false")
  // and it stays after a reload
  await page.reload()
  await page.locator("[data-stage=review] button").click()
  await page.locator(`[data-chapter-id="${chapterId}"] button`).click()
  await expect(page.locator(`[data-segment-id="${rows[2]!.id}"]`)).toHaveAttribute("data-verified", "true")
})

test("the chosen paragraph's kind is changed from its menu", async ({ page, door, sql }) => {
  const { chapterId, rows } = fresh(sql, 1)
  const id = rows.find((r) => rowOf(sql, r.id).kind === "paragraph")!.id
  await review(page, door, chapterId)
  const row = page.locator(`[data-segment-id="${id}"]`)
  await row.locator("[data-kind]").click()
  await expect(row).toHaveAttribute("data-selected", "true")
  await row.getByRole("combobox", { name: "Kind" }).click()
  await page.getByRole("option", { name: "Quote" }).click()
  await expect.poll(() => rowOf(sql, id).kind).toBe("blockquote")
  await expect(row.getByRole("combobox", { name: "Kind" })).toHaveText("Quote")
  await expect(page.getByRole("listbox")).toHaveCount(0)
})

test("a click on the text opens it for editing where it landed; Enter saves it, and the OCR text stays as it was", async ({ page, door, sql }) => {
  const { chapterId, rows } = fresh(sql, 2)
  const id = rows.find((r) => String(rowOf(sql, r.id).source_text).length > 40)!.id
  const was = rowOf(sql, id)
  await review(page, door, chapterId)
  const row = page.locator(`[data-segment-id="${id}"]`)
  const editor = row.locator("[contenteditable=true]")
  await row.locator("[data-side=source]").click({ position: { x: 1, y: 6 } })
  await expect(editor).toBeFocused()
  await expect(row).toHaveAttribute("data-selected", "true")
  await page.keyboard.insertText("[fixed] ")
  await page.keyboard.press("Enter")
  await expect(editor).toHaveCount(0)
  await expect.poll(() => rowOf(sql, id).source_text).toBe(`[fixed] ${was.source_text}`)
  const now = rowOf(sql, id)
  expect(JSON.parse(String(now.source_doc)).content).toHaveLength(1)
  expect(now.ocr_text).toBe(was.ocr_text)
  expect(Number(now.version)).toBeGreaterThan(Number(was.version))
  await expect(row.locator("[data-side=source]")).toHaveText(`[fixed] ${was.source_text}`)
})

test("keyboard only: Enter opens the chosen paragraph, Space types a space, Tab saves and goes on with the scan following, Esc drops", async ({ page, door, sql }) => {
  const { chapterId, rows } = fresh(sql, 3)
  const { shown, selected } = await review(page, door, chapterId)
  await page.locator("header").click()
  await page.keyboard.press("ArrowDown")
  const second = rows[1]!
  const secondWas = String(rowOf(sql, second.id).source_text)
  await expect(selected).toHaveAttribute("data-segment-id", String(second.id))
  await page.keyboard.press("Enter")
  const editor = page.locator(`[data-segment-id="${second.id}"] [contenteditable=true]`)
  await expect(editor).toBeFocused()
  await page.keyboard.press(" ")
  await page.keyboard.insertText("[end]")
  await page.keyboard.press("Tab")
  await expect.poll(() => rowOf(sql, second.id).source_text).toBe(`${secondWas} [end]`)
  expect(rowOf(sql, second.id).verified, "Space in the editor typed, it did not verify").toBe(0)
  const third = rows[2]!
  await expect(page.locator(`[data-segment-id="${third.id}"] [contenteditable=true]`)).toBeFocused()
  await expect(selected).toHaveAttribute("data-segment-id", String(third.id))
  await expect(shown).toHaveAttribute("data-page-no", String(third.pageStart))
  const before = rowOf(sql, third.id)
  await page.keyboard.insertText("버릴 글")
  await page.keyboard.press("Escape")
  await expect(page.locator("[contenteditable=true]")).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(rowOf(sql, third.id)).toEqual(before)
  expect(sourceDraft(sql, third.id)).toBe(null)
})

test("an emptied source is refused and kept as a draft, which comes back after a reload", async ({ page, door, sql, complaints }) => {
  const { chapterId, rows } = fresh(sql, 4)
  const id = rows[0]!.id
  const was = rowOf(sql, id)
  await review(page, door, chapterId)
  const row = page.locator(`[data-segment-id="${id}"]`)
  await row.locator("[data-side=source]").click()
  await expect(row.locator("[contenteditable=true]")).toBeFocused()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.press("Backspace")
  await page.keyboard.press("Enter")
  await expect(page.locator("[data-sonner-toast]")).toContainText("cannot be empty")
  expect(rowOf(sql, id).source_text).toBe(was.source_text)
  await expect.poll(() => sourceDraft(sql, id)).not.toBe(null)
  await expect(row.locator("[data-draft]")).toContainText("Unsaved draft")

  await page.reload()
  await page.locator("[data-stage=review] button").click()
  await page.locator(`[data-chapter-id="${chapterId}"] button`).click()
  const again = page.locator(`[data-segment-id="${id}"]`)
  await expect(again.locator("[data-draft]")).toContainText("Unsaved draft")
  await again.locator("[data-draft]").getByRole("button", { name: "Discard" }).click()
  await expect.poll(() => sourceDraft(sql, id)).toBe(null)
  await expect(again.locator("[data-side=source]")).toHaveText(String(was.source_text))
  complaints.length = 0 // the refused save is the point of this test
})

// ---- what was changed since the OCR

test("a paragraph changed since the OCR is marked, and shows word by word what was changed", async ({ page, door, sql }) => {
  // the copy has OCR slips fixed by hand: "winglow" became "window"
  const fixed = sql.prepare("SELECT id, chapter_id FROM segment WHERE ocr_text LIKE '%winglow%' AND source_text LIKE '%window%'").get()
  expect(fixed, "the copy has the winglow → window fix").toBeTruthy()
  const chapterId = Number(fixed!.chapter_id)
  await review(page, door, chapterId)
  const marked = sql.prepare("SELECT id FROM segment WHERE chapter_id = ? AND ocr_text IS NOT NULL AND ocr_text <> source_text ORDER BY idx").all(chapterId).map((r) => String(r.id))
  await expect(page.locator("[data-segment-id]:has([data-edited])")).toHaveCount(marked.length)
  expect(await page.locator("[data-segment-id]:has([data-edited])").evaluateAll((els) => els.map((el) => el.getAttribute("data-segment-id")))).toEqual(marked)

  await page.locator(`[data-segment-id="${fixed!.id}"] [data-edited]`).click()
  const diff = page.locator("[data-diff]")
  await expect(diff).toBeVisible()
  await expect(diff.locator("del")).toHaveText(["winglow,"])
  await expect(diff.locator("ins")).toHaveText(["window,"])
  await page.keyboard.press("Escape")
  await expect(diff).toHaveCount(0)
})

test("a paragraph fixed here gains the mark; one with no OCR text has none", async ({ page, door, sql }) => {
  const { chapterId, rows } = fresh(sql, 5)
  const id = rows.find((r) => { const x = rowOf(sql, r.id); return x.ocr_text !== null && x.ocr_text === x.source_text && String(x.source_text).split(" ").length > 3 })!.id
  await review(page, door, chapterId)
  const row = page.locator(`[data-segment-id="${id}"]`)
  await expect(row.locator("[data-edited]")).toHaveCount(0)
  await row.locator("[data-side=source]").click({ position: { x: 1, y: 6 } })
  await expect(row.locator("[contenteditable=true]")).toBeFocused()
  await page.keyboard.insertText("Indeed, ")
  await page.keyboard.press("Enter")
  await expect(row.locator("[data-edited]")).toHaveCount(1)
  await row.locator("[data-edited]").click()
  await expect(page.locator("[data-diff] ins")).toHaveText(["Indeed,"])
  await expect(page.locator("[data-diff] del")).toHaveCount(0)
  await page.keyboard.press("Escape")
  // ⌘Z takes the fix back, and the mark with it
  await page.locator("header").click()
  await page.keyboard.press("ControlOrMeta+z")
  await expect(row.locator("[data-edited]")).toHaveCount(0)
})
