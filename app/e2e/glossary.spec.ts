import { expect, test, type Locator } from "@playwright/test"

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
  await page.getByRole("button", { name: /15: Los Pericos/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Los Pericos/)
  const row = rows.filter({ hasText: "Zemurray" }).first()
  await expect(row).toBeVisible()

  // 1) select → Add to glossary → dotted mark (no translation yet)
  await selectWord(row.locator("p").first(), "Zemurray")
  await page.getByRole("button", { name: "Add to glossary" }).click()
  await expect(row.locator('mark[data-term="Zemurray"]').first()).toBeVisible()
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")

  // 2) Glossary tab: fill the translation, Enter saves
  await page.getByRole("tab", { name: "Glossary" }).click()
  const entry = page.locator('[data-glossary-term="Zemurray"]')
  await expect(entry).toContainText("×")
  const tr = entry.getByRole("textbox", { name: "Translation of Zemurray" })
  await tr.fill("제무레이")
  await tr.press("Enter")
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  await row.locator('mark[data-term="Zemurray"]').first().hover()
  await expect(page.getByText("Zemurray → 제무레이")).toBeVisible()

  // 3) Translate mode: a translation that spells the name differently is flagged; fixing it clears the flag
  await page.getByRole("tab", { name: "Translate" }).click()
  const pair = page.locator("[data-pair]").filter({ hasText: "Zemurray" }).first()
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
