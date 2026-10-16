import { expect, test, type Locator } from "@playwright/test"

/** Select a row without starting to edit: click its header strip (the kind badge), not the text. */
const selectRow = (row: Locator) => row.locator("[data-slot=badge], [data-slot=toggle-group]").first().click()

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
  const rows = page.locator("[data-segment]")
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
  const again = page.locator("[data-segment]").nth(1)
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
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Ripes/)
  const before = await rows.count()
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()
  await row.locator("p").click() // clicking the text starts editing in place

  const box = row.getByRole("textbox")
  const cut = original.indexOf(" ", 40) + 1 // after a space, well inside the paragraph
  await setCaret(box, cut)
  // ProseMirror syncs its selection from the DOM on the next key event; nudge right then left
  await box.press("ArrowRight")
  await box.press("ArrowLeft")
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
  const rows = page.locator("[data-segment]")
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
  await expect(page.locator("[data-segment]")).toHaveCount(before - 1)
})

test("keyboard-only review: arrows move, space verifies, enter edits, cmd+z undoes", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /4: Brown to Green/ }).click()
  const rows = page.locator("[data-segment]")
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
  const rows = page.locator("[data-segment]")
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
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Octopus/)
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()
  const firstWord = original.split(" ")[0]

  await row.locator("p").click()
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
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/New Orleans/)
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()
  const lineWidths = (sel: string) =>
    row.locator(sel).first().evaluate((el) => {
      const r = document.createRange(); r.selectNodeContents(el)
      return Array.from(r.getClientRects()).map((x) => Math.round(x.width))
    })
  const before = await lineWidths("p")

  await selectRow(row)
  await page.keyboard.press("Enter")
  const box = row.getByRole("textbox")
  await expect(box).toBeFocused()
  // every line must break at the same place: entering edit mode is invisible to the eye
  expect(await lineWidths(".ProseMirror p")).toEqual(before)

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

test("clicking a word starts editing with the caret at that word; clicking another row saves and moves", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /8: The Isthmus/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Isthmus/)
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()
  const words = original.split(" ")
  const target = words[5]
  // click the middle of the 6th word
  const box = await row.locator("p").evaluate((el, w: string) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const n = walker.nextNode()!
    const i = n.textContent!.indexOf(w); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length)
    const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }, target)
  await page.mouse.click(box.x, box.y)
  await expect(row.getByRole("textbox")).toBeFocused()
  await page.keyboard.type("@")
  const typed = await row.getByRole("textbox").innerText()
  const at = typed.indexOf("@")
  const start = original.indexOf(target)
  expect(at).toBeGreaterThanOrEqual(start)
  expect(at).toBeLessThanOrEqual(start + target.length)

  // clicking another row's text saves this one and starts editing there
  await rows.nth(2).locator("p").click()
  await expect(rows.nth(2).getByRole("textbox")).toBeFocused()
  await expect(row.getByRole("textbox")).toHaveCount(0)
  await expect(row.locator("p")).toContainText("@")
  await expect(page.locator("footer [role=status]")).toHaveText("저장됨")
})

test("tab moves editing to the next paragraph, shift+tab back, each step saves", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /9: To the Collins/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Collins/)
  const t = (i: number) => rows.nth(i).locator("p")
  const [o1, o2, o3] = await Promise.all([1, 2, 3].map(async (i) => (await t(i).innerText()).trim()))

  await t(1).click()
  await expect(rows.nth(1).getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Meta+ArrowDown"); await page.keyboard.type(" ONE")
  await page.keyboard.press("Tab")
  await expect(rows.nth(2).getByRole("textbox")).toBeFocused()
  await expect(t(1)).toHaveText(o1 + " ONE")
  await page.keyboard.press("Meta+ArrowDown"); await page.keyboard.type(" TWO")
  await page.keyboard.press("Tab")
  await expect(rows.nth(3).getByRole("textbox")).toBeFocused()
  await expect(t(2)).toHaveText(o2 + " TWO")
  await page.keyboard.press("Shift+Tab")
  await expect(rows.nth(2).getByRole("textbox")).toBeFocused()
  await expect(t(3)).toHaveText(o3)
  await page.keyboard.press("Escape")
  await expect(page.locator("footer [role=status]")).toHaveText("저장됨")
})

test("an interrupted edit is offered for recovery after reload, and discarded on demand", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /10: Revolutin/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Revolutin/)
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()

  await row.locator("p").click()
  await expect(row.getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Meta+ArrowDown")
  await page.keyboard.type(" DRAFT")
  await page.waitForTimeout(500) // past the draft debounce
  await page.reload() // "crash": the edit was never committed

  await page.getByRole("button", { name: /10: Revolutin/ }).click()
  const again = page.locator("[data-segment]").nth(1)
  await expect(again.locator("p")).toHaveText(original)
  await expect(again.getByText("저장 안 됨")).toBeVisible()
  await again.getByRole("button", { name: "복구" }).click()
  await expect(again.getByRole("textbox")).toHaveText(original + " DRAFT")
  await page.keyboard.press("Enter")
  await expect(again.locator("p")).toHaveText(original + " DRAFT")
  await expect(again.getByText("저장 안 됨")).toHaveCount(0)
  await page.reload()
  await page.getByRole("button", { name: /10: Revolutin/ }).click()
  await expect(page.locator("[data-segment]").nth(1).getByText("저장 안 됨")).toHaveCount(0)

  // discard path
  const row2 = page.locator("[data-segment]").nth(2)
  await row2.locator("p").click()
  await expect(row2.getByRole("textbox")).toBeFocused()
  await page.keyboard.type("x")
  await page.waitForTimeout(500)
  await page.reload()
  await page.getByRole("button", { name: /10: Revolutin/ }).click()
  const row2b = page.locator("[data-segment]").nth(2)
  await row2b.getByRole("button", { name: "버리기" }).click()
  await expect(row2b.getByText("저장 안 됨")).toHaveCount(0)
})

test("a failed save keeps the draft so nothing is lost", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /11: To the Isthmus/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Isthmus/)
  const row = rows.nth(1)
  const original = (await row.locator("p").innerText()).trim()

  await page.route("**/api/updateSegment", (r) => r.abort())
  await row.locator("p").click()
  await expect(row.getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Meta+ArrowDown")
  await page.keyboard.type(" KEEP")
  await page.waitForTimeout(500)
  await page.keyboard.press("Enter")
  await expect(page.locator("footer [role=status]")).toHaveText("저장 실패")
  await expect(row.locator("p")).toHaveText(original)
  await expect(row.getByText("저장 안 됨")).toBeVisible()

  await page.unroute("**/api/updateSegment")
  await row.getByRole("button", { name: "복구" }).click()
  await expect(row.getByRole("textbox")).toBeFocused()
  await expect(row.getByRole("textbox")).toHaveText(original + " KEEP")
  await page.keyboard.press("Enter")
  await expect(row.locator("p")).toHaveText(original + " KEEP")
  await expect(page.locator("footer [role=status]")).toHaveText("저장됨")
})

test("the selected segment is outlined on the scanned page and follows the selection", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /12: The Banana War/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Banana War/)
  await selectRow(rows.nth(1))

  const mark = page.getByTestId("segment-highlight")
  await expect(mark).toBeVisible()
  const img = page.getByRole("img", { name: /원서 \d+쪽/ })
  const [m1, i] = await Promise.all([mark.boundingBox(), img.boundingBox()])
  expect(m1!.x).toBeGreaterThanOrEqual(i!.x - 1)
  expect(m1!.x + m1!.width).toBeLessThanOrEqual(i!.x + i!.width + 1)
  expect(m1!.y).toBeGreaterThanOrEqual(i!.y - 1)
  expect(m1!.height).toBeGreaterThan(10)

  await page.keyboard.press("ArrowDown")
  await expect.poll(async () => (await mark.boundingBox())!.y).not.toBe(m1!.y)
})

test("paging the scan across a chapter boundary switches the chapter; empty pages say so", async ({ page }) => {
  await page.goto("/")
  // Prologue runs to p.8; chapter 1 (Selma) starts at p.11
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Prologue/)
  const last = rows.last()
  await selectRow(last)
  const lastPage = Number((await page.locator("[data-slot=resizable-panel]").first().getByText(/^p\. \d+$/).innerText()).replace("p. ", ""))

  const next = page.getByRole("button", { name: "다음 페이지" })
  for (let p = lastPage; p < 11; p++) await next.click()
  await expect(page.locator("[data-slot=resizable-panel]").first().getByText("p. 11", { exact: true })).toBeVisible()
  await expect(rows.first()).toHaveText(/Selma/)
  await expect(page.locator("footer")).toContainText("1: Selma")

  // p.9 / p.10 are blank pages between chapters
  const prev = page.getByRole("button", { name: "이전 페이지" })
  await prev.click()
  await expect(page.locator("[data-slot=scroll-area] [role=status]")).toContainText("p. 10")
  await expect(page.locator("[data-slot=scroll-area] [role=status]")).toContainText("이 쪽에는 단락이 없습니다")
})

test("a caption can be added on an empty page, edited, and undone", async ({ page }) => {
  await page.goto("/")
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Prologue/)
  const count = await rows.count()
  await selectRow(rows.last())
  const next = page.getByRole("button", { name: "다음 페이지" })
  const notice = page.locator("[data-slot=scroll-area] [role=status]")
  // walk forward until a blank page inside the Prologue range shows the notice (p.9/10)
  for (let i = 0; i < 4 && !(await notice.count()); i++) await next.click()
  await expect(notice).toContainText("이 쪽에는 단락이 없습니다")
  const pageText = (await notice.locator("span").first().innerText()).trim()

  await notice.getByRole("button", { name: "캡션 추가" }).click()
  await expect(rows).toHaveCount(count + 1)
  const row = rows.last()
  await expect(row.getByRole("textbox")).toBeFocused()
  await page.keyboard.type("Zemurray on the docks, 1910")
  await page.keyboard.press("Enter")
  await expect(row.locator("p")).toHaveText("Zemurray on the docks, 1910")
  await expect(row.getByRole("button", { name: "캡션" })).toHaveAttribute("aria-pressed", "true")
  // the new row sits under a header for the formerly empty page
  await expect(row.locator("xpath=preceding-sibling::div[1]")).toHaveText(pageText)
  await expect(notice).toHaveCount(0)
  await expect(page.locator("footer [role=status]")).toHaveText("저장됨")

  await page.reload()
  await expect(page.locator("[data-segment]")).toHaveCount(count + 1)
  await page.keyboard.press("Meta+z") // the text edit
  await page.keyboard.press("Meta+z") // the insert
  await expect(page.locator("[data-segment]")).toHaveCount(count)
})
