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
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /16: Bananas Go to War/ }).click()
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
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  await item.getByRole("button", { name: "Resolve" }).click()
  await expect(row.locator("mark[data-comment]")).toHaveCount(0)
  await expect(page.locator("[data-open-comments]")).toHaveText("0 open")
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")

  await page.locator("footer").click({ position: { x: 300, y: 10 } }) // drop focus out of the panel
  await page.keyboard.press("Meta+z")
  await expect(row.locator("mark[data-comment]")).toHaveText(word, { timeout: 10000 })
})

test("translator's note: add on the translation, asterisk marker with tooltip, edit body, delete", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /17: Israel is Real/ }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
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

test("keyboard selection inside the editor shows the same toolbar; a comment made there is anchored after saving", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /19: Backlash/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Backlash/)
  const row = rows.nth(1)
  await row.locator("p").first().click()
  await expect(row.getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Meta+ArrowUp")
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowRight")
  const toolbar = page.locator("[data-floating-toolbar]")
  await expect(toolbar).toBeVisible()
  await expect(toolbar.getByRole("button", { name: "Comment" })).toBeVisible()
  await toolbar.getByRole("button", { name: "Comment" }).click()
  await toolbar.getByRole("textbox", { name: "Comment" }).fill("From the keyboard")
  await toolbar.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  // leave the editor; the mark appears on the stored text
  await page.keyboard.press("Escape")
  await expect(row.locator("mark[data-comment]")).toHaveCount(1)
  const marked = await row.locator("mark[data-comment]").innerText()
  expect(marked.length).toBeGreaterThan(0)
})

test("author's note: provisional number at the paragraph's end, placed after selected words, undo unplaces it", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /17: Israel is Real/ }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  const pairs = page.locator("[data-pair]")
  await expect(pairs.first()).toContainText("Israel")
  const pair = pairs.nth(7) // its source carries the chapter's first author's note ("several hundred Jewish refugees")
  await expect(pair).toContainText("several hundred Jewish refugees")
  await pair.locator("[data-target]").click()
  await expect(pair.getByRole("textbox", { name: "Edit translation" })).toBeFocused()
  await page.keyboard.type("수백 명의 유대인 난민이 그 도시에 도착했다.")
  await page.keyboard.press("Tab")
  const target = pair.locator("[data-target]")
  await expect(target).toContainText("난민")

  // not placed: grey number at the end of the paragraph
  const marker = target.locator("sup[data-note]")
  await expect(marker).toHaveText("1")
  await expect(marker).toHaveAttribute("data-provisional", "true")
  await expect(target).toHaveText(/도착했다\.1$/)

  await target.scrollIntoViewIfNeeded()
  await selectWord(target, "난민")
  await page.getByRole("button", { name: "Place note 1" }).click()
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  await expect(marker).not.toHaveAttribute("data-provisional", "true")
  await expect(target).toHaveText(/난민1이 그 도시에/)

  await page.locator("footer").click({ position: { x: 300, y: 10 } }) // drop focus out of the toolbar
  await page.keyboard.press("Meta+z")
  await expect(target).toHaveText(/도착했다\.1$/)
  await expect(marker).toHaveAttribute("data-provisional", "true")
})

test("author's note: the panel shows the English and takes a translation; the badge counts the rest", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /17: Israel is Real/ }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  const pair = page.locator("[data-pair]").nth(7)
  await expect(pair).toContainText("several hundred Jewish refugees")
  const marker = pair.locator("p[lang=en] sup[data-note]").first()
  await marker.click()
  const item = page.locator("[data-panel-note]").first()
  await expect(item).toContainText("Author's note")
  await expect(item).toContainText("Most of these émigrés")
  const badge = page.locator("[data-untranslated-notes]")
  const before = Number((await badge.innerText()).match(/\d+/)![0])
  const field = item.getByRole("textbox", { name: "Note translation" })
  await field.fill("이 이민자 대부분은 1960년까지 미국으로 옮겨 갔다.")
  await field.blur()
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  await expect(badge).toContainText(String(before - 1))
  await field.fill("")
  await field.blur()
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  await expect(badge).toContainText(String(before))
})
