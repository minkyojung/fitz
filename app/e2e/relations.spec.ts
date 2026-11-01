import { DatabaseSync } from "node:sqlite"

import { expect, test, type Locator } from "@playwright/test"

// Relations (docs/relations.md): the e2e book is a copy of the translator's own; this test's terms and relations are its
// own, so it starts from a copy without them.
const TERMS = ["Zemurray", "United Fruit"]
test.beforeEach(() => {
  const db = new DatabaseSync("/tmp/fitz-e2e.db", { timeout: 5000 })
  try {
    db.prepare("DELETE FROM relation").run()
    const { id } = db.prepare("SELECT id FROM book LIMIT 1").get() as { id: number }
    for (const term of TERMS) {
      db.prepare("DELETE FROM glossary WHERE term = ?").run(term)
      db.prepare("INSERT INTO glossary(book_id, term, translation, aliases, kind) VALUES (?, ?, ?, '', ?)").run(id, term, term === "Zemurray" ? "제무레이" : "유나이티드 프루트", term === "Zemurray" ? "person" : "org")
    }
  } finally { db.close() }
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

test("a relation drawn from the selected words rests on their paragraph; the Relations tab draws it, lights it for that paragraph, goes back to it, and removes it; ⌘Z brings it back", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /15: Los Pericos/ }).click()
  const pairs = page.locator("[data-pair]")
  await expect(pairs.first()).toBeVisible()
  const pair = pairs.filter({ hasText: "Zemurray" }).first()
  await expect(pair).toBeVisible()
  const pairId = await pair.getAttribute("data-pair")

  // 1) select → Add relation: the term the words name is the first end; pick the other and write the label
  await selectWord(pair.locator("p").first(), "Zemurray")
  await page.getByRole("button", { name: "Add relation" }).click()
  const form = page.locator("[data-relation-form]")
  await expect(form.getByRole("combobox", { name: "From" })).toContainText("Zemurray")
  await form.getByRole("combobox", { name: "To" }).click()
  await page.getByRole("option", { name: /United Fruit/ }).click()
  await form.getByRole("textbox", { name: "Relation" }).fill("경영권을 잡았다")
  await form.getByRole("button", { name: "Add relation" }).click()
  await expect(form).toHaveCount(0)
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")
  // the paragraph wears the count
  const mark = pair.locator("[data-relations]")
  await expect(mark).toHaveText("1")

  // 2) the mark opens the Relations tab; the paragraph is selected, so its relation is lit
  await mark.click()
  await expect(page.getByRole("tab", { name: "Relations" })).toHaveAttribute("aria-selected", "true")
  const label = page.locator("[data-relation]")
  await expect(label).toHaveText("경영권을 잡았다")
  await expect(label).toHaveAttribute("data-lit", "true")
  await expect(page.locator("[data-relation-node='Zemurray']")).toBeVisible()
  await expect(page.locator("[data-relation-node='United Fruit']")).toBeVisible()

  // another paragraph selected: the relation dims
  await pairs.first().click()
  await expect(label).not.toHaveAttribute("data-lit", "true")
  // the label goes back to its paragraph
  await label.click()
  await expect(page.locator("[data-pair][data-selected]")).toHaveAttribute("data-pair", pairId!)
  await expect(label).toHaveAttribute("data-lit", "true")

  // 3) removed from the graph; ⌘Z brings it back
  await label.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Remove relation" }).click()
  await expect(label).toHaveCount(0)
  await expect(page.getByText("No relations yet")).toBeVisible()
  await expect(mark).toHaveCount(0)
  await page.locator("body").click({ position: { x: 700, y: 400 } })
  await page.keyboard.press("Meta+z")
  await expect(label).toHaveText("경영권을 잡았다")
  await expect(mark).toHaveText("1")
})

test("a relation recorded elsewhere (Claude, another window) is drawn when the tab opens; gone from the book, it is gone from the graph", async ({ page }) => {
  {
    const db = new DatabaseSync("/tmp/fitz-e2e.db", { timeout: 5000 })
    try {
      const { id } = db.prepare("SELECT id FROM book LIMIT 1").get() as { id: number }
      const seg = db.prepare("SELECT id FROM segment WHERE source_text LIKE '%Zemurray%' ORDER BY id LIMIT 1").get() as { id: number }
      db.prepare("INSERT INTO relation(book_id, from_term, to_term, label, segment_id) VALUES (?, 'Zemurray', 'United Fruit', '세운 사람', ?)").run(id, seg.id)
    } finally { db.close() }
  }
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Reference", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("tab", { name: "Relations" }).click()
  await expect(page.locator("[data-relation]")).toHaveText("세운 사람")
  {
    const db = new DatabaseSync("/tmp/fitz-e2e.db", { timeout: 5000 })
    try { db.prepare("DELETE FROM relation").run() } finally { db.close() }
  }
  await page.reload()
  await page.getByRole("tab", { name: "Relations" }).click()
  await expect(page.getByText("No relations yet")).toBeVisible()
})
