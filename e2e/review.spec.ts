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
