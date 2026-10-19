import { expect, test, type Locator } from "@playwright/test"

/** The paragraph's stored text: what the read view shows minus inline spelling-fix insertions. */
const rowText = (row: Locator) =>
  row.locator("p").first().evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement
    clone.querySelectorAll("ins[data-spell-fix]").forEach((n) => n.remove())
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim()
  })

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
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /1: Selma/ }).click()

  // second row = first body paragraph of chapter 1 (row 0 is the heading)
  const rows = page.locator("[data-segment]")
  await expect(rows.nth(1)).toContainText("Sam Zemurray saw his first banana")
  const row = rows.nth(1)
  await row.click()

  // verify
  await row.getByRole("checkbox", { name: "Verified" }).click()
  await expect(row.getByRole("checkbox", { name: "Verified" })).toBeChecked()
  await expect(page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /1: Selma/ })).toContainText("1/15")

  // kind
  await row.getByRole("button", { name: "Quote" }).click()

  // text edit
  await row.getByRole("button", { name: "Edit text" }).click()
  const box = row.getByRole("textbox")
  await box.fill("Edited paragraph text.")
  await box.press("Meta+Enter")
  await expect(row).toContainText("Edited paragraph text.")

  await page.reload()
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /1: Selma/ }).click()
  const again = page.locator("[data-segment]").nth(1)
  await expect(again).toContainText("Edited paragraph text.")
  await expect(again.getByRole("checkbox", { name: "Verified" })).toBeChecked()
  await again.click()
  await expect(again.getByRole("button", { name: "Quote" })).toHaveAttribute("aria-pressed", "true")
})

test("page navigation follows the selected segment", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /1: Selma/ }).click()
  await expect(page.getByText("p. 11", { exact: true }).first()).toBeVisible()
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(page.getByText("p. 12", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("img", { name: "Book page 12" })).toBeVisible()
})

test("split at caret and merge back restore the paragraph", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /2: Ripes/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Ripes/)
  const before = await rows.count()
  const row = rows.nth(1)
  const original = await rowText(row)
  await row.locator("p").click() // clicking the text starts editing in place

  const box = row.getByRole("textbox")
  const cut = original.indexOf(" ", 40) + 1 // after a space, well inside the paragraph
  await setCaret(box, cut)
  // ProseMirror syncs its selection from the DOM on the next key event; nudge right then left
  await box.press("ArrowRight")
  await box.press("ArrowLeft")
  await row.getByRole("button", { name: "Split at caret" }).click()

  await expect(rows).toHaveCount(before + 1)
  await expect(rows.nth(1).locator("p")).toHaveText(original.slice(0, cut).trim())
  await expect(rows.nth(2).locator("p")).toHaveText(original.slice(cut).trim())

  await rows.nth(1).click()
  await rows.nth(1).getByRole("button", { name: "Merge with next" }).click()
  await expect(rows).toHaveCount(before)
  await expect(rows.nth(1).locator("p")).toHaveText(original)
})

test("an unanchored note can be linked to a segment", async ({ page }) => {
  await page.goto("/")
  const panel = page.locator("[data-slot=resizable-panel]").last()
  await panel.getByRole("tab", { name: /^Notes/ }).click()
  await expect(panel.getByRole("button", { name: "Link" }).first()).toBeVisible()
  const before = await panel.getByRole("button", { name: "Link" }).count()
  expect(before).toBeGreaterThan(0)
  await expect(page.locator("footer")).toContainText(`Unlinked notes ${before}`)

  await panel.getByRole("button", { name: "Link" }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByPlaceholder(/[Pp]aragraph/).fill("Zemurray")
  await dialog.getByRole("option").first().click()

  await expect(panel.getByRole("button", { name: "Link" })).toHaveCount(before - 1)
  await expect(page.locator("footer")).toContainText(`Unlinked notes ${before - 1}`)
  await page.reload()
  await expect(page.locator("footer")).toContainText(`Unlinked notes ${before - 1}`)
})

test("undo restores a merge, redo reapplies it", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /3: The Fruit Jobber/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Fruit Jobber/)
  const before = await rows.count()
  const second = await rowText(rows.nth(2))

  await selectRow(rows.nth(1))
  await rows.nth(1).getByRole("button", { name: "Merge with next" }).click()
  await expect(rows).toHaveCount(before - 1)
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(rows).toHaveCount(before)
  await expect(rows.nth(2).locator("p")).toHaveText(second)

  await page.getByRole("button", { name: "Redo" }).click()
  await expect(rows).toHaveCount(before - 1)

  await page.reload()
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /3: The Fruit Jobber/ }).click()
  await expect(page.locator("[data-segment]")).toHaveCount(before - 1)
})

test("keyboard-only review: arrows move, space verifies, enter edits, cmd+z undoes", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /4: Brown to Green/ }).click()
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
  await expect(page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /4: Brown to Green/ })).toContainText("3/")

  await page.keyboard.press("Meta+z")
  await expect(rows.nth(3).getByRole("checkbox")).not.toBeChecked()
  await expect(page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /4: Brown to Green/ })).toContainText("2/")

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
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /5: Bananas/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Bananas/)
  const status = page.locator("footer [role=status]")
  await expect(status).toHaveText("")

  await rows.nth(1).click()
  await rows.nth(1).getByRole("checkbox").click()
  await expect(status).toHaveText("Saved")

  await page.route("**/api/updateSegment", (r) => r.abort())
  await rows.nth(2).click()
  await rows.nth(2).getByRole("checkbox").click()
  await expect(status).toHaveText("Save failed")
  await expect(rows.nth(2).getByRole("checkbox")).not.toBeChecked()

  await page.unroute("**/api/updateSegment")
  await rows.nth(2).getByRole("checkbox").click()
  await expect(status).toHaveText("Saved")
  await expect(rows.nth(2).getByRole("checkbox")).toBeChecked()
})

test("edits are highlighted against the OCR original and listed in history", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /6: The Octopus/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Octopus/)
  const row = rows.nth(1)
  const original = await rowText(row)
  const firstWord = original.split(" ")[0]

  await row.locator("p").click()
  await row.getByRole("textbox").fill(original.replace(firstWord, "EDITED"))
  await row.getByRole("textbox").press("Meta+Enter")

  const dot = row.locator("[data-edited]")
  await expect(dot).toBeVisible()
  await dot.hover()
  await expect(page.getByText("Edited — original OCR")).toBeVisible()
  await expect(page.locator("[data-slot=tooltip-content] del, [role=tooltip] del").last()).toContainText(firstWord)

  const history = page.getByRole("list", { name: "History of this paragraph" })
  await expect(history.getByRole("button", { name: /Edit paragraph/ })).toHaveCount(1)
  await history.getByRole("button", { name: /Edit paragraph/ }).click()
  await expect(history.locator("del")).toContainText(firstWord)
  await expect(history.locator("ins")).toContainText("EDITED")

  await page.keyboard.press("Meta+z")
  await expect(row.locator("[data-edited]")).toHaveCount(0)
  await expect(history.getByText("Undone")).toBeVisible()
})

test("in-place editing: no layout shift, character undo inside, paragraph undo after", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /7: New Orleans/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/New Orleans/)
  // a row without spelling marks: inline fixes change the read view's flow until accepted
  const row = rows.filter({ hasNot: page.locator("mark[data-spell]") }).nth(1)
  const original = await rowText(row)
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
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /8: The Isthmus/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Isthmus/)
  // pin the two rows by id: filtered locators are live and would shift once marks come and go
  const candidate = rows.filter({ hasNot: page.locator("mark[data-spell]") }).nth(1)
  const row = page.locator(`[data-segment="${await candidate.getAttribute("data-segment")}"]`)
  const nextRow = page.locator(`[data-segment="${await rows.nth(2).getAttribute("data-segment")}"]`)
  await row.scrollIntoViewIfNeeded()
  const original = await rowText(row)
  const words = original.split(" ")
  const target = words[5]
  // click the middle of the 6th word (search every text node; marks may split the paragraph)
  const box = await row.locator("p").evaluate((el, w: string) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w)
      if (i === -1) continue
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length)
      const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    throw new Error("word not found: " + w)
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
  await nextRow.locator("p").click()
  await expect(nextRow.getByRole("textbox")).toBeFocused()
  await expect(row.getByRole("textbox")).toHaveCount(0)
  await expect(row.locator("p")).toContainText("@")
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
})

test("tab moves editing to the next paragraph, shift+tab back, each step saves", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /9: To the Collins/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Collins/)
  const t = (i: number) => rows.nth(i).locator("p")
  const [o1, o2, o3] = await Promise.all([1, 2, 3].map((i) => rowText(rows.nth(i))))

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
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
})

test("an interrupted edit is offered for recovery after reload, and discarded on demand", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /10: Revolutin/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Revolutin/)
  const row = rows.nth(1)
  const original = await rowText(row)

  await row.locator("p").click()
  await expect(row.getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Meta+ArrowDown")
  await page.keyboard.type(" DRAFT")
  await page.waitForTimeout(500) // past the draft debounce
  await page.reload() // "crash": the edit was never committed

  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /10: Revolutin/ }).click()
  const again = page.locator("[data-segment]").nth(1)
  await expect(again.locator("p")).toHaveText(original)
  await expect(again.getByText("Unsaved")).toBeVisible()
  await again.getByRole("button", { name: "Recover" }).click()
  await expect(again.getByRole("textbox")).toHaveText(original + " DRAFT")
  await page.keyboard.press("Enter")
  await expect(again.locator("p")).toHaveText(original + " DRAFT")
  await expect(again.getByText("Unsaved")).toHaveCount(0)
  await page.reload()
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /10: Revolutin/ }).click()
  await expect(page.locator("[data-segment]").nth(1).getByText("Unsaved")).toHaveCount(0)

  // discard path
  const row2 = page.locator("[data-segment]").nth(2)
  // on its first word: a click on a marked word (a suspect spelling, a term) opens that word's popover instead
  await row2.locator("p").click({ position: { x: 4, y: 4 } })
  await expect(row2.getByRole("textbox")).toBeFocused()
  await page.keyboard.type("x")
  await page.waitForTimeout(500)
  await page.reload()
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /10: Revolutin/ }).click()
  const row2b = page.locator("[data-segment]").nth(2)
  await row2b.getByRole("button", { name: "Discard" }).click()
  await expect(row2b.getByText("Unsaved")).toHaveCount(0)
})

test("a failed save keeps the draft so nothing is lost", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /11: To the Isthmus/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Isthmus/)
  const row = rows.nth(1)
  const original = await rowText(row)

  await page.route("**/api/updateSegment", (r) => r.abort())
  await row.locator("p").click()
  await expect(row.getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Meta+ArrowDown")
  await page.keyboard.type(" KEEP")
  await page.waitForTimeout(500)
  await page.keyboard.press("Enter")
  await expect(page.locator("footer [role=status]")).toHaveText("Save failed")
  await expect(row.locator("p")).toHaveText(original)
  await expect(row.getByText("Unsaved")).toBeVisible()

  await page.unroute("**/api/updateSegment")
  await row.getByRole("button", { name: "Recover" }).click()
  await expect(row.getByRole("textbox")).toBeFocused()
  await expect(row.getByRole("textbox")).toHaveText(original + " KEEP")
  await page.keyboard.press("Enter")
  await expect(row.locator("p")).toHaveText(original + " KEEP")
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
})

test("the selected segment is outlined on the scanned page and follows the selection", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /12: The Banana War/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Banana War/)
  await selectRow(rows.nth(1))

  const mark = page.getByTestId("segment-highlight")
  await expect(mark).toBeVisible()
  const img = page.getByRole("img", { name: /Book page \d+/ })
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

  const next = page.getByRole("button", { name: "Next page" })
  for (let p = lastPage; p < 11; p++) await next.click()
  await expect(page.locator("[data-slot=resizable-panel]").first().getByText("p. 11", { exact: true })).toBeVisible()
  await expect(rows.first()).toHaveText(/Selma/)
  await expect(page.locator("footer")).toContainText("1: Selma")

  // p.9 / p.10 are blank pages between chapters
  const prev = page.getByRole("button", { name: "Previous page" })
  await prev.click()
  await expect(page.locator("[data-slot=scroll-area] [role=status]")).toContainText("p. 10")
  await expect(page.locator("[data-slot=scroll-area] [role=status]")).toContainText("No paragraphs on this page")
})

test("a caption can be added on an empty page, edited, and undone", async ({ page }) => {
  await page.goto("/")
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Prologue/)
  const count = await rows.count()
  await selectRow(rows.last())
  const next = page.getByRole("button", { name: "Next page" })
  const notice = page.locator("[data-slot=scroll-area] [role=status]")
  // walk forward until a blank page inside the Prologue range shows the notice (p.9/10)
  for (let i = 0; i < 4 && !(await notice.count()); i++) await next.click()
  await expect(notice).toContainText("No paragraphs on this page")
  const pageText = (await notice.locator("span").first().innerText()).trim()

  await notice.getByRole("button", { name: "Add caption" }).click()
  await expect(rows).toHaveCount(count + 1)
  const row = rows.last()
  await expect(row.getByRole("textbox")).toBeFocused()
  await page.keyboard.type("Zemurray on the docks, 1910")
  await page.keyboard.press("Enter")
  await expect(row.locator("p")).toHaveText("Zemurray on the docks, 1910")
  await expect(row.getByRole("button", { name: "Caption" })).toHaveAttribute("aria-pressed", "true")
  // the new row sits under a header for the formerly empty page
  await expect(row.locator("xpath=preceding-sibling::div[1]")).toHaveText(pageText)
  await expect(notice).toHaveCount(0)
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")

  await page.reload()
  await expect(page.locator("[data-segment]")).toHaveCount(count + 1)
  await page.keyboard.press("Meta+z") // the text edit
  await page.keyboard.press("Meta+z") // the insert
  await expect(page.locator("[data-segment]")).toHaveCount(count)
})

test("find lists hits across the book, jumps to one, and replace-all is a single undo step", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("[data-segment]").first()).toHaveText(/Prologue/)
  await page.locator("body").click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("Meta+f")
  const find = page.getByRole("textbox", { name: "Find", exact: true })
  await expect(find).toBeFocused()
  await find.fill("Zemurray")
  const status = page.locator("[data-slot=tabs-content][data-state=active], [role=tabpanel]").locator("[role=status]").first()
  await expect(status).toContainText(/\d+ paragraphs, \d+ matches/)
  const hitCount = Number((await status.innerText()).match(/(\d+) paragraphs/)![1])
  expect(hitCount).toBeGreaterThan(5)

  // jump to a hit in a later chapter
  const hit = page.getByRole("tabpanel").getByRole("button", { name: /13: King Fish/ }).first()
  await hit.click()
  await expect(page.locator("footer")).toContainText("13: King Fish")
  await expect(page.locator("[data-segment]").filter({ has: page.locator("[data-slot=toggle-group]") })).toContainText("Zemurray")

  // replace all, then undo in one step
  await page.getByRole("textbox", { name: "Replace with" }).fill("ZEMURRAY")
  await page.getByRole("button", { name: /Replace all/ }).click()
  await expect(status).toContainText("No matches")
  await find.fill("ZEMURRAY")
  // the book already had a few all-caps occurrences, so at least every replaced segment shows up
  await expect.poll(async () => Number((await status.innerText()).match(/(\d+) paragraphs/)?.[1] ?? 0)).toBeGreaterThanOrEqual(hitCount)
  await page.locator("body").click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("Meta+z")
  await find.fill("Zemurray")
  await expect(status).toContainText(`${hitCount} paragraphs`)
})

test("spelling: suspects are marked, a confident fix is accepted inline, a name is added to the dictionary", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("[data-segment]").first()).toHaveText(/Prologue/)
  // make an OCR-style error: turn a sentence-initial "It was" into "Tt was"
  await page.locator("body").click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("Meta+f")
  const find = page.getByRole("textbox", { name: "Find", exact: true })
  await find.fill("It was a brisk night")
  await page.getByRole("tabpanel").getByRole("button", { name: /Prologue/ }).first().click()
  const row = page.locator("[data-segment]").filter({ has: page.locator("[data-slot=toggle-group]") })
  await expect(row).toContainText("It was a brisk night")
  const original = await rowText(row)
  await row.locator("p").click()
  await expect(row.getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Meta+ArrowUp")
  await page.keyboard.press("Shift+ArrowRight")
  await page.keyboard.press("Shift+ArrowRight")
  await page.keyboard.type("Tt")
  await page.keyboard.press("Enter")
  await expect.poll(() => rowText(row)).toContain("Tt was a brisk")

  // the suspect is struck and the contextual fix "It" is offered inline
  const mark = row.locator("mark[data-spell]", { hasText: "Tt" })
  await expect(mark).toBeVisible()
  await expect(row.locator("[data-suspects]")).toContainText("Suspects")
  await expect(row.locator("[data-spell-fix]")).toHaveText("It")
  await row.locator("[data-spell-fix]").click()
  await expect.poll(() => rowText(row)).toBe(original)
  await expect(row.locator("mark[data-spell]", { hasText: "Tt" })).toHaveCount(0)
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")

  // a name with no evidence gets no inline fix; add it to the dictionary and it stays gone after reload
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /9: To the Collins/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Collins/)
  const name = rows.locator("mark[data-spell]", { hasText: "Hondurefio" }).first()
  await expect(name).toBeVisible()
  await expect(page.locator("footer [data-suspect-total]")).not.toHaveText("Suspects 0")
  await name.click()
  await page.getByRole("option", { name: "Add to dictionary" }).click()
  await expect(rows.locator("mark[data-spell]", { hasText: "Hondurefio" })).toHaveCount(0)
  await page.reload()
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /9: To the Collins/ }).click()
  await expect(page.locator("[data-segment]").first()).toHaveText(/Collins/)
  await expect(page.locator("[data-segment]").first()).toBeVisible()
  await expect(page.locator("mark[data-spell]", { hasText: "Hondurefio" })).toHaveCount(0)
  await page.locator("body").click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("Meta+z") // removes the dictionary word again
  await expect(page.locator("mark[data-spell]", { hasText: "Hondurefio" }).first()).toBeVisible()
})

test("translate mode: facing pairs, blocks inside a pair, confirm-and-next, persistence, undo", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("[data-segment]").first()).toHaveText(/Prologue/)
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /14: The Fish That Swallowed/ }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  const pairs = page.locator("[data-pair]")
  await expect(pairs.first()).toContainText("The Fish That Swallowed")
  // the first unconfirmed pair is selected; its translation is empty
  const pair = pairs.nth(1)
  await expect(pair.locator("[data-target]")).toContainText("Translate…")
  await expect(pair.locator("[data-status]")).toHaveAttribute("data-status", "untranslated")

  await pair.locator("[data-target]").click()
  const box = pair.getByRole("textbox", { name: "Edit translation" })
  await expect(box).toBeFocused()
  await page.keyboard.type("첫 번째 덩어리.")
  await page.keyboard.press("Enter")
  await page.keyboard.type("두 번째 덩어리.")
  await page.keyboard.press("Meta+Enter")

  // saved as reviewed with two blocks; the next pair opened for editing
  await expect(pair.locator("[data-status]")).toHaveAttribute("data-status", "reviewed")
  await expect(pair.locator("[data-target] p")).toHaveCount(2)
  await expect(pair.locator("[data-target] p").nth(1)).toHaveText("두 번째 덩어리.")
  await expect(pairs.nth(2).getByRole("textbox", { name: "Edit translation" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.locator("footer")).toContainText("Confirmed 1 /")
  await expect(page.locator("footer [data-sheets]")).toContainText("sheets")

  await page.reload()
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /14: The Fish That Swallowed/ }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  await expect(page.locator("[data-pair]").nth(1).locator("[data-target] p")).toHaveCount(2)

  await page.locator("body").click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("Meta+z")
  await expect(page.locator("[data-pair]").nth(1).locator("[data-target]")).toContainText("Translate…")
  await expect(page.locator("[data-pair]").nth(1).locator("[data-status]")).toHaveAttribute("data-status", "untranslated")
})
