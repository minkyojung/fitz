import { expect, test, type Locator } from "@playwright/test"

async function selectWord(block: Locator, word: string) {
  await block.evaluate((el, w: string) => {
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

test("comments: add on the source, see the mark, reply, resolve (mark disappears), undo brings it back", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /16: Bananas Go to War/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Bananas Go to War/)
  const row = rows.nth(1)
  const word = (await row.locator("p").first().innerText()).trim().split(" ").find((w) => /^[A-Za-z]{5,}$/.test(w))!

  await selectWord(row.locator("p").first(), word)
  await page.getByRole("button", { name: "Comment" }).click()
  await page.getByRole("textbox", { name: "Comment" }).fill("Check this wording")
  await page.getByRole("button", { name: "Comment", exact: true }).click()
  const mark = row.locator("mark[data-comment]")
  await expect(mark).toHaveText(word)
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")

  // mark → panel item selected; reply; resolve
  await mark.click()
  const item = page.locator("[data-panel-comment]").first()
  await expect(item).toContainText("Check this wording")
  await item.getByRole("textbox", { name: "Reply" }).fill("Agreed, keep")
  await item.getByRole("textbox", { name: "Reply" }).press("Enter")
  await expect(item).toContainText("Agreed, keep")
  await item.getByRole("button", { name: "Resolve" }).click()
  await expect(row.locator("mark[data-comment]")).toHaveCount(0)
  await expect(page.locator("[data-open-comments]")).toHaveText("0 open")

  await page.locator("body").click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("Meta+z")
  await expect(row.locator("mark[data-comment]")).toHaveText(word)
})

test("translator's note: add on the translation, asterisk marker with tooltip, edit body, delete", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /17: Israel is Real/ }).click()
  await page.getByRole("tab", { name: "Translate" }).click()
  const pairs = page.locator("[data-pair]")
  await expect(pairs.first()).toContainText("Israel")
  const pair = pairs.nth(1)
  await pair.locator("[data-target]").click()
  await expect(pair.getByRole("textbox", { name: "Edit translation" })).toBeFocused()
  await page.keyboard.type("그는 뉴올리언스로 돌아왔다.")
  await page.keyboard.press("Tab")
  await expect(pair.locator("[data-target]")).toContainText("뉴올리언스")

  await selectWord(pair.locator("[data-target]"), "뉴올리언스")
  await page.getByRole("button", { name: "Translator's note" }).click()
  await page.getByRole("textbox", { name: "Translator's note" }).fill("루이지애나주의 항구 도시.")
  await page.getByRole("button", { name: "Add note" }).click()
  const marker = pair.locator("sup[data-note]")
  await expect(marker).toHaveText("*")
  const tooltip = page.locator("[data-slot=tooltip-content], [role=tooltip]")
  await marker.hover()
  await expect(tooltip.filter({ hasText: "루이지애나주의 항구 도시." })).toBeVisible()

  await marker.click()
  const item = page.locator("[data-panel-note]").first()
  await expect(item).toContainText("Translator's note")
  const body = item.getByRole("textbox", { name: "Note body" })
  await body.fill("루이지애나주의 항구 도시. 제무레이의 본거지.")
  await body.blur()
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  await page.mouse.move(5, 5)
  await marker.hover()
  await expect(tooltip.filter({ hasText: "제무레이의 본거지" })).toBeVisible()
  await item.getByRole("button", { name: "Delete note" }).click()
  await expect(pair.locator("sup[data-note]")).toHaveCount(0)
})
