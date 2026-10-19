import { expect, test, type Locator, type Page } from "@playwright/test"

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

  // mark → its thread opens beside it; reply; resolve
  await mark.click()
  const item = page.locator("[data-thread]").first()
  await expect(item).toContainText("Check this wording")
  await item.getByRole("textbox", { name: "Reply" }).fill("Agreed, keep")
  await item.getByRole("textbox", { name: "Reply" }).press("Enter")
  await expect(item).toContainText("Agreed, keep")
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  await item.getByRole("button", { name: "Resolve" }).click()
  await expect(row.locator("mark[data-comment]")).toHaveCount(0)
  await expect(page.locator("[data-open-comments]")).toHaveText("0 open")
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")

  await page.locator("footer [role=status]").click() // drop focus out of the thread
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
  const item = pair.locator("[data-footnote]").first()  // under the translation, as a footnote
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

/** Press at the start of the words and drag to their end, as a hand does; the button stays down. */
async function dragOver(block: Locator, words: string) {
  const box = await block.evaluate((el, w: string) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w)
      if (i === -1) continue
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length)
      const b = r.getBoundingClientRect(); return { left: b.left, right: b.right, y: b.top + b.height / 2 }
    }
    throw new Error("words not found: " + w)
  }, words)
  const page = block.page()
  await page.mouse.move(box.left + 1, box.y)
  await page.mouse.down()
  await page.mouse.move(box.right - 1, box.y, { steps: 8 })
  try { await expect.poll(() => page.evaluate(() => window.getSelection()!.toString()), { timeout: 1000 }).toBe(words) }
  catch (e) { await page.mouse.up(); throw e }
  // give the app the frames it would need to put the toolbar up
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))))
}

test("a mouse selection shows the toolbar when the button is let go, not while dragging over the words; in the editor too", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /19: Backlash/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Backlash/)
  const toolbar = page.locator("[data-floating-toolbar]")
  const block = rows.nth(1).locator("p").first()
  const words = (await block.innerText()).trim().split(" ").slice(0, 2).join(" ")

  await dragOver(block, words)
  await expect(toolbar).toHaveCount(0)
  await page.mouse.up()
  await expect(toolbar).toBeVisible()
  await expect(toolbar).toHaveAttribute("data-quote", words)
  await expect(rows.nth(1).getByRole("textbox")).toHaveCount(0) // a drag, not a click: the editor did not open

  await rows.nth(2).locator("p").first().click()
  const editor = rows.nth(2).getByRole("textbox")
  await expect(editor).toBeFocused()
  const inEditor = (await editor.innerText()).trim().split(" ").slice(0, 2).join(" ")
  // just after it gains focus, ProseMirror puts back its own selection (20 ms later): a drag begun sooner than any hand could is lost
  await expect(async () => { await dragOver(editor, inEditor) }).toPass()
  await expect(toolbar).toHaveCount(0)
  await page.mouse.up()
  await expect(toolbar).toBeVisible()
  await expect(toolbar).toHaveAttribute("data-quote", inEditor)
  await page.keyboard.press("Escape")
})

/** Whether the toolbar sits just under the selected words, or how far off it is. */
const toolbarPlace = (page: Page) => page.evaluate(() => {
  const w = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
  const t = document.querySelector("[data-floating-toolbar]")!.getBoundingClientRect()
  const gap = t.top - w.bottom
  return gap >= 0 && gap <= 12 && t.left < w.right && w.left < t.right ? "under the words" : `${Math.round(gap)}px off`
})
const wordsTop = (page: Page) => page.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().top)
/** Scroll the list the block is in, as its scrollbar would. */
const scrollList = (block: Locator, dy: number) => block.evaluate((el, dy) => el.closest('[data-slot="scroll-area-viewport"]')!.scrollBy(0, dy), dy)
/** The first long paragraph that can be scrolled to show its first line low in the list, its end running below the list's
 *  edge; scrolls it there. By the list's own edges, not the window's, so the shell around it may change. */
const longParagraphLow = (rows: Locator) => rows.evaluateAll((els) => {
  for (const [i, el] of els.entries()) {
    const list = el.closest('[data-slot="scroll-area-viewport"]')!
    const by = el.querySelector("p")!.getBoundingClientRect().top - (list.getBoundingClientRect().bottom - 120)
    const to = list.scrollTop + by
    if (el.getBoundingClientRect().height > 400 && to >= 0 && to <= list.scrollHeight - list.clientHeight) { list.scrollBy(0, by); return i }
  }
  return -1
})
/** Where a plain word of the block is: not a marked one, which opens a popover of its own. */
const plainWord = (block: Locator) => block.evaluate((el) => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.textContent!.search(/\S/)
    if (n.parentElement !== el || i === -1) continue
    const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1)
    const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  }
  throw new Error("no plain word")
})
const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

test("a paragraph picked with the mouse is selected where it is, its words stay put; one reached by the keys is brought into view", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /19: Backlash/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Backlash/)
  const n = await longParagraphLow(rows)
  expect(n).not.toBe(-1)
  const block = rows.nth(n).locator("p").first()

  // words dragged over. They stay where they were, but for the selected row's taller header (its controls, a line);
  // brought into view, they would go up by most of the paragraph
  await dragOver(block, (await block.innerText()).trim().split(" ").slice(0, 2).join(" "))
  const was = await wordsTop(page)
  await page.mouse.up()
  await expect(page.locator("[data-floating-toolbar]")).toBeVisible()
  await twoFrames(page)
  expect(Math.abs((await wordsTop(page)) - was)).toBeLessThan(40)

  // the keys: the next paragraph, below the list's edge, comes into view
  await page.keyboard.press("ArrowDown")
  await expect(rows.nth(n + 1)).toBeInViewport()

  // a click on a word, which opens the editor there (once the words dragged over are let go: a click inside them only lets go)
  await page.evaluate(() => window.getSelection()!.removeAllRanges())
  expect(await longParagraphLow(rows)).toBe(n)
  const top = (await block.boundingBox())!.y
  const word = await plainWord(block)
  await page.mouse.click(word.x, word.y)
  const editor = rows.nth(n).getByRole("textbox")
  await expect(editor).toBeFocused()
  await twoFrames(page)
  expect(Math.abs((await editor.boundingBox())!.y - top)).toBeLessThan(40) // the editor opened where the paragraph was
  await page.keyboard.press("Escape")
})

test("the toolbar stays with its words when the list scrolls: under the wheel, out of sight and back; in the editor too", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /19: Backlash/ }).click()
  const rows = page.locator("[data-segment]")
  await expect(rows.first()).toHaveText(/Backlash/)
  const toolbar = page.locator("[data-floating-toolbar]")
  const n = await longParagraphLow(rows)
  expect(n).not.toBe(-1)
  const block = rows.nth(n).locator("p").first()
  const words = (await block.innerText()).trim().split(" ").slice(0, 2).join(" ")
  await dragOver(block, words)
  await page.mouse.up()
  await expect(toolbar).toBeVisible()
  await expect.poll(() => toolbarPlace(page)).toBe("under the words")

  // the wheel, near the list's top, away from the toolbar
  const top = await block.evaluate((el) => { const r = el.closest('[data-slot="scroll-area-viewport"]')!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 60 } })
  await page.mouse.move(top.x, top.y)
  await page.mouse.wheel(0, 120)
  await expect.poll(() => toolbarPlace(page)).toBe("under the words")

  // the words scrolled out of the list: the toolbar goes with them, and comes back with them
  const away = Math.round(await wordsTop(page)) + 100 // above the top of the window
  await scrollList(block, away)
  await expect(toolbar).toBeHidden()
  await scrollList(block, -away)
  await expect(toolbar).toBeVisible()
  await expect.poll(() => toolbarPlace(page)).toBe("under the words")

  // in the editor: a keyboard selection, then the list scrolls
  await rows.nth(n).getByRole("button", { name: "Edit text" }).click()
  const editor = rows.nth(n).getByRole("textbox")
  await expect(editor).toBeFocused()
  await page.keyboard.press("Meta+ArrowUp")
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowRight")
  await expect(toolbar).toBeVisible()
  await scrollList(editor, 120)
  await expect.poll(() => toolbarPlace(page)).toBe("under the words")
  await page.keyboard.press("Escape")
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

test("author's note: under the translation it shows the English and takes a translation; the status bar counts the rest", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /17: Israel is Real/ }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  const pair = page.locator("[data-pair]").nth(7)
  await expect(pair).toContainText("several hundred Jewish refugees")
  const marker = pair.locator("p[lang=en] sup[data-note]").first()
  await marker.click()
  const item = pair.locator("[data-footnote]").filter({ hasText: "Author's note" }).first()  // under the translation
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
