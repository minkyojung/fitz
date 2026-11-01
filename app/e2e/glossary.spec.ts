import { DatabaseSync } from "node:sqlite"

import { expect, test, type Locator } from "@playwright/test"

// The e2e book is a copy of the translator's own (playwright.config.ts), whose glossary grows as they work: this test
// adds "Zemurray", so it starts from a copy without it.
test.beforeEach(() => {
  const db = new DatabaseSync("/tmp/fitz-e2e.db", { timeout: 5000 })
  try { db.prepare("DELETE FROM glossary WHERE term = 'Zemurray'").run() } finally { db.close() }
})

/** Select a word inside a read-only source paragraph (fires selectionchange like a mouse drag). */
async function selectWord(p: Locator, word: string) {
  await p.evaluate((el, w: string) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w)
      if (i === -1) continue
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length)
      const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r); return
    }
    throw new Error("word not found: " + w)
  }, word)
}

test("glossary: add a term from a selection, set its translation, see it marked, and get warned when the translation omits it", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /15: Los Pericos/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Los Pericos/)
  const row = rows.filter({ hasText: "Zemurray" }).first()
  await expect(row).toBeVisible()

  // 1) select → Add to glossary → dotted mark (no translation yet)
  await selectWord(row.locator("p").first(), "Zemurray")
  await page.getByRole("button", { name: "Add to glossary" }).click()
  await expect(row.locator('mark[data-term="Zemurray"]').first()).toBeVisible()
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")

  // 2) Translate: the source is read-only there, so a click on the term's mark opens it to set the translation;
  // Enter saves and closes
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  const pair = page.locator("[data-pair]").filter({ hasText: "Zemurray" }).first()
  const mark = pair.locator('mark[data-term="Zemurray"]').first()
  await mark.click()
  const tr = page.getByRole("textbox", { name: "Translation of Zemurray" })
  await tr.fill("제무레이")
  await tr.press("Enter")
  await expect(tr).toHaveCount(0)
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  await mark.hover()
  await expect(page.getByText("Zemurray → 제무레이")).toBeVisible()

  // 3) a translation that spells the name differently is flagged; fixing it clears the flag
  await pair.locator("[data-target]").click()
  await expect(pair.getByRole("textbox", { name: "Edit translation" })).toBeFocused()
  await page.keyboard.type("제무라이는 이 땅을 샀다.")
  await page.keyboard.press("Tab") // Esc would discard; Tab saves and moves on
  await expect(pair.locator("[data-term-missing]")).toBeVisible()
  await pair.locator("[data-target]").click()
  await expect(pair.getByRole("textbox", { name: "Edit translation" })).toBeFocused()
  await page.keyboard.press("Meta+a")
  await page.keyboard.type("제무레이는 이 땅을 샀다.")
  await page.keyboard.press("Tab")
  await expect(pair.locator("[data-target]")).toContainText("제무레이는")
  await expect(pair.locator("[data-term-missing]")).toHaveCount(0)
})

test("the glossary is a tab of the reference column: untranslated first, set in place, its badges count down; a term opens at its first mention", async ({ page }) => {
  {
    const db = new DatabaseSync("/tmp/fitz-e2e.db", { timeout: 5000 })
    try {
      const { id } = db.prepare("SELECT id FROM book LIMIT 1").get() as { id: number }
      db.prepare("INSERT INTO glossary(book_id, term, translation, aliases, kind) VALUES (?, 'Zemurray', '', '', 'person')").run(id)
    } finally { db.close() }
  }
  await page.goto("/")
  // Review opens the column on the scan; the glossary is the tab beside it, its badge the terms without a translation
  const reference = page.getByRole("button", { name: "Reference", exact: true })
  await expect(reference).toHaveAttribute("aria-pressed", "true")
  const tab = page.getByRole("tab", { name: /^Glossary/ })
  const badge = tab.locator("[data-slot=badge]")
  const pending = Number(await badge.innerText())
  expect(pending).toBeGreaterThan(0)
  await tab.click()
  await expect(tab).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("navigation", { name: "Chapters" })).toBeVisible()  // the paragraph never leaves: the chapters stay

  const rows = page.locator("li[data-glossary-term]")
  const translated = await rows.evaluateAll((els) => els.map((e) => (e.querySelector("[lang=ko]") ? 1 : 0)))
  expect(translated).toEqual([...translated].sort())  // untranslated first
  await page.getByRole("button", { name: /Without translation/ }).click()
  await expect(rows).toHaveCount(pending)
  await page.getByRole("textbox", { name: "Filter terms" }).fill("Zemurray")
  await expect(rows).toHaveCount(1)
  await page.getByRole("button", { name: "Zemurray", exact: true }).click()
  const tr = page.getByRole("textbox", { name: "Translation of Zemurray" })
  await tr.fill("제머레이")
  await tr.press("Enter")
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  await expect(rows).toHaveCount(0)  // translated, it leaves the untranslated
  await expect(page.locator("[data-pending-terms]")).toHaveText(String(pending - 1))
  if (pending > 1) await expect(badge).toHaveText(String(pending - 1))
  else await expect(badge).toHaveCount(0)

  await page.getByRole("button", { name: /Without translation/ }).click()
  const row = page.locator('li[data-glossary-term="Zemurray"]')  // the filter also finds the terms that contain the name
  await expect(row).toBeVisible()
  const first = row.getByRole("button", { name: "First mention" })
  if (!(await first.isVisible())) await row.getByRole("button", { name: "Zemurray", exact: true }).click()
  await first.click()
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(page.locator("[data-segment][data-selected]")).toContainText("Zemurray")

  // closed, the column's button wears a dot while terms wait for a translation
  await page.keyboard.press("Meta+i")
  await expect(reference).toHaveAttribute("aria-pressed", "false")
  if (pending > 1) await expect(reference.locator("[data-attention]")).toBeVisible()
})
