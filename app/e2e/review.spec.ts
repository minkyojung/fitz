import { expect, test, type Locator } from "@playwright/test"

/** Put the caret at a text offset inside a contenteditable paragraph (ProseMirror reads the DOM selection). */
async function setCaret(editable: Locator, offset: number) {
  await editable.evaluate((el, pos: number) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode(), left = pos
    while (node && left > (node.textContent?.length ?? 0)) { left -= node.textContent!.length; node = walker.nextNode() }
    if (!node) throw new Error("offset beyond text")
    const range = document.createRange(); range.setStart(node, left); range.collapse(true)
    const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range)
    el.dispatchEvent(new Event("selectionchange"))
  }, offset)
}

test("review edits persist across reload", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /1: Selma/ }).click()

  // second row = first body paragraph of chapter 1 (row 0 is the heading)
  const rows = page.locator("[data-slot=scroll-area] .group")
  await expect(rows.nth(1)).toContainText("Sam Zemurray saw his first banana")
  const row = rows.nth(1)
  await row.click()

  // verify
  await row.getByRole("checkbox", { name: "확인됨" }).click()
  await expect(row.getByRole("checkbox", { name: "확인됨" })).toBeChecked()
  await expect(page.getByRole("button", { name: /1: Selma/ })).toContainText("1/15")

  // kind
  await row.getByRole("button", { name: "인용" }).click()

  // text edit
  await row.getByRole("button", { name: "텍스트 수정" }).click()
  const box = row.getByRole("textbox")
  await box.fill("Edited paragraph text.")
  await box.press("Meta+Enter")
  await expect(row).toContainText("Edited paragraph text.")

  await page.reload()
  await page.getByRole("button", { name: /1: Selma/ }).click()
  const again = page.locator("[data-slot=scroll-area] .group").nth(1)
  await expect(again).toContainText("Edited paragraph text.")
  await expect(again.getByRole("checkbox", { name: "확인됨" })).toBeChecked()
  await again.click()
  await expect(again.getByRole("button", { name: "인용" })).toHaveAttribute("aria-pressed", "true")
})

test("page navigation follows the selected segment", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /1: Selma/ }).click()
  await expect(page.getByText("p. 11", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "다음 페이지" }).click()
  await expect(page.getByText("p. 12", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("img", { name: "원서 12쪽" })).toBeVisible()
})

test("split at caret and merge back restore the paragraph", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /2: Ripes/ }).click()
  const rows = page.locator("[data-slot=scroll-area] .group")
  await expect(rows.first()).toHaveText(/Ripes/)
  const before = await rows.count()
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()
  await row.click()

  await row.getByRole("button", { name: "텍스트 수정" }).click()
  const box = row.getByRole("textbox")
  const cut = original.indexOf(" ", 40) + 1 // after a space, well inside the paragraph
  await setCaret(box, cut)
  await row.getByRole("button", { name: "커서 위치에서 분할" }).click()

  await expect(rows).toHaveCount(before + 1)
  await expect(rows.nth(1).locator("p")).toHaveText(original.slice(0, cut).trim())
  await expect(rows.nth(2).locator("p")).toHaveText(original.slice(cut).trim())

  await rows.nth(1).click()
  await rows.nth(1).getByRole("button", { name: "다음 단락과 병합" }).click()
  await expect(rows).toHaveCount(before)
  await expect(rows.nth(1).locator("p")).toHaveText(original)
})

test("an unanchored note can be linked to a segment", async ({ page }) => {
  await page.goto("/")
  const panel = page.locator("[data-slot=resizable-panel]").last()
  await panel.getByRole("tab", { name: /미연결 미주/ }).click()
  await expect(panel.getByRole("button", { name: "연결" }).first()).toBeVisible()
  const before = await panel.getByRole("button", { name: "연결" }).count()
  expect(before).toBeGreaterThan(0)
  await expect(page.locator("footer")).toContainText(`미연결 미주 ${before}`)

  await panel.getByRole("button", { name: "연결" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder(/단락/).fill("Zemurray")
  await dialog.getByRole("option").first().click()

  await expect(panel.getByRole("button", { name: "연결" })).toHaveCount(before - 1)
  await expect(page.locator("footer")).toContainText(`미연결 미주 ${before - 1}`)
  await page.reload()
  await expect(page.locator("footer")).toContainText(`미연결 미주 ${before - 1}`)
})

test("undo restores a merge, redo reapplies it", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /3: The Fruit Jobber/ }).click()
  const rows = page.locator("[data-slot=scroll-area] .group")
  await expect(rows.first()).toHaveText(/Fruit Jobber/)
  const before = await rows.count()
  const second = (await rows.nth(2).locator("p").innerText()).trim()

  await rows.nth(1).click()
  await rows.nth(1).getByRole("button", { name: "다음 단락과 병합" }).click()
  await expect(rows).toHaveCount(before - 1)

  await page.getByRole("button", { name: "되돌리기" }).click()
  await expect(rows).toHaveCount(before)
  await expect(rows.nth(2).locator("p")).toHaveText(second)

  await page.getByRole("button", { name: "다시 실행" }).click()
  await expect(rows).toHaveCount(before - 1)

  await page.reload()
  await page.getByRole("button", { name: /3: The Fruit Jobber/ }).click()
  await expect(page.locator("[data-slot=scroll-area] .group")).toHaveCount(before - 1)
})

test("keyboard-only review: arrows move, space verifies, enter edits, cmd+z undoes", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /4: Brown to Green/ }).click()
  const rows = page.locator("[data-slot=scroll-area] .group")
  await expect(rows.first()).toHaveText(/Brown to Green/)
  await page.locator("body").click({ position: { x: 5, y: 5 } }) // drop focus from the sidebar button

  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Space")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Space")
  await expect(rows.nth(1).getByRole("checkbox")).toBeChecked()
  await expect(rows.nth(2).getByRole("checkbox")).toBeChecked()
  await expect(rows.nth(3).getByRole("checkbox")).toBeChecked()
  await expect(page.getByRole("button", { name: /4: Brown to Green/ })).toContainText("3/")

  await page.keyboard.press("Meta+z")
  await expect(rows.nth(3).getByRole("checkbox")).not.toBeChecked()
  await expect(page.getByRole("button", { name: /4: Brown to Green/ })).toContainText("2/")

  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("Enter")
  const box = rows.nth(2).getByRole("textbox")
  await expect(box).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(box).toHaveCount(0)
  // space inside the editor must type, not toggle
  await page.keyboard.press("Enter")
  await rows.nth(2).getByRole("textbox").press("End")
  await rows.nth(2).getByRole("textbox").press("Space")
  await expect(rows.nth(2).getByRole("checkbox")).toBeChecked()
  await page.keyboard.press("Escape")
})

test("status bar shows saved, and save failure when the server rejects", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /5: Bananas/ }).click()
  const rows = page.locator("[data-slot=scroll-area] .group")
  await expect(rows.first()).toHaveText(/Bananas/)
  const status = page.locator("footer [role=status]")
  await expect(status).toHaveText("")

  await rows.nth(1).click()
  await rows.nth(1).getByRole("checkbox").click()
  await expect(status).toHaveText("저장됨")

  await page.route("**/api/updateSegment", (r) => r.abort())
  await rows.nth(2).click()
  await rows.nth(2).getByRole("checkbox").click()
  await expect(status).toHaveText("저장 실패")
  await expect(rows.nth(2).getByRole("checkbox")).not.toBeChecked()

  await page.unroute("**/api/updateSegment")
  await rows.nth(2).getByRole("checkbox").click()
  await expect(status).toHaveText("저장됨")
  await expect(rows.nth(2).getByRole("checkbox")).toBeChecked()
})

test("edits are highlighted against the OCR original and listed in history", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /6: The Octopus/ }).click()
  const rows = page.locator("[data-slot=scroll-area] .group")
  await expect(rows.first()).toHaveText(/Octopus/)
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()
  const firstWord = original.split(" ")[0]

  await row.click()
  await row.getByRole("button", { name: "텍스트 수정" }).click()
  await row.getByRole("textbox").fill(original.replace(firstWord, "EDITED"))
  await row.getByRole("textbox").press("Meta+Enter")

  const mark = row.locator("mark[data-edit]")
  await expect(mark).toHaveText("EDITED")
  await expect(mark).toHaveAttribute("aria-label", `원문: ${firstWord}`)

  const history = page.getByRole("list", { name: "이 단락의 기록" })
  await expect(history.getByRole("button", { name: /단락 수정/ })).toHaveCount(1)
  await history.getByRole("button", { name: /단락 수정/ }).click()
  await expect(history.locator("del")).toContainText(firstWord)
  await expect(history.locator("ins")).toContainText("EDITED")

  await page.keyboard.press("Meta+z")
  await expect(row.locator("mark[data-edit]")).toHaveCount(0)
  await expect(history.getByText("되돌려짐")).toBeVisible()
})

test("in-place editing: no layout shift, character undo inside, paragraph undo after", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /7: New Orleans/ }).click()
  const rows = page.locator("[data-slot=scroll-area] .group")
  await expect(rows.first()).toHaveText(/New Orleans/)
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()
  const heightBefore = (await row.boundingBox())!.height

  await row.click()
  await page.keyboard.press("Enter")
  const box = row.getByRole("textbox")
  await expect(box).toBeFocused()
  expect(Math.abs((await row.boundingBox())!.height - heightBefore)).toBeLessThan(2)

  await page.keyboard.press("End")
  await page.keyboard.type(" EXTRA")
  await expect(box).toHaveText(original + " EXTRA")
  await page.keyboard.press("Meta+z") // editor-level undo: characters only
  await expect(box).toHaveText(original)
  await page.keyboard.type(" AGAIN")
  await page.keyboard.press("Enter") // commit
  await expect(row.getByRole("textbox")).toHaveCount(0)
  await expect(row.locator("p")).toHaveText(original + " AGAIN")

  await page.keyboard.press("Meta+z") // app-level undo: the whole edit
  await expect(row.locator("p")).toHaveText(original)
  await expect(row.locator("mark[data-edit]")).toHaveCount(0)
})
