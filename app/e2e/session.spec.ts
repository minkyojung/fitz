import { DatabaseSync } from "node:sqlite"

import { expect, test, type Locator } from "@playwright/test"

// Session (docs/session.md) on the e2e copy of the book. Cards are put in the database as an evening run would keep
// them — no Claude runs here (the e2e server is on a copy, so its evening clock is off). The words asked about are
// read from the copy when the test runs, so the book's text is not written here.

const DB = "/tmp/fitz-e2e.db"
const pad = (n: number) => String(n).padStart(2, "0")
const d = new Date()
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Words of `text` that occur in it once: the first run of `n` words that does. */
function onceIn(text: string, n: number) {
  const words = text.split(/\s+/)
  for (let i = 0; i + n <= words.length; i++) {
    const q = words.slice(i, i + n).join(" ").replace(/[.,;:!?”’"]+$/, "")
    if (q.length > 3 && text.indexOf(q) === text.lastIndexOf(q)) return q
  }
  throw new Error("no words that occur once")
}

/** Session emptied, then today's cards as a run keeps them: two cards on a translated paragraph (the right option
 *  second for one, fourth for the other) and a challenge on its translation. */
function seed() {
  const db = new DatabaseSync(DB, { timeout: 5000 })
  try {
    db.exec("DELETE FROM drill_review; DELETE FROM drill_card; DELETE FROM drill_pick; DELETE FROM drill_run; DELETE FROM meta WHERE key = 'drill_more'")
    const s = db.prepare("SELECT id, chapter_id, source_text, target_text, version FROM segment WHERE target_text IS NOT NULL AND length(target_text) > 20 ORDER BY id LIMIT 1").get() as
      { id: number; chapter_id: number; source_text: string; target_text: string; version: number }
    db.prepare("INSERT INTO drill_run(id, slot, status, made, finished_at) VALUES (1, ?, 'done', 3, datetime('now'))").run(TODAY)
    const card = db.prepare(`INSERT INTO drill_card(run_id, segment_id, kind, origin, written_by, quote, question, options, answer, proposal, why, base_version, due_on, made_on)
      VALUES (1, ?, ?, 'claude', 'translator', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const first = onceIn(s.source_text, 2)
    const second = onceIn(s.source_text.slice(s.source_text.indexOf(first) + first.length), 2)
    card.run(s.id, "meaning", first, "첫 카드의 질문", JSON.stringify(["가", "나", "다", "라"]), 1, null, "첫 카드의 이유", s.version, TODAY, TODAY)
    card.run(s.id, "nuance", second, "둘째 카드의 질문", JSON.stringify(["하나", "둘", "셋", "넷"]), 3, null, "둘째 카드의 이유", s.version, TODAY, TODAY)
    const quote = onceIn(s.target_text, 1)
    card.run(s.id, "challenge", quote, "챌린지의 질문", null, null, `${quote}(고침)`, "챌린지의 이유", s.version, TODAY, TODAY)
    return { segment: s, quote }
  } finally { db.close() }
}
const query = <T,>(sql: string, ...args: (string | number)[]) => {
  const db = new DatabaseSync(DB, { timeout: 5000 })
  try { return db.prepare(sql).get(...args) as T } finally { db.close() }
}

test.afterAll(() => {
  const db = new DatabaseSync(DB, { timeout: 5000 })
  try { db.exec("DELETE FROM drill_review; DELETE FROM drill_card; DELETE FROM drill_pick; DELETE FROM drill_run; DELETE FROM meta WHERE key = 'drill_more'") } finally { db.close() }
})

test("a day's session: cards graded, a wrong one asked again until right, a challenge's words used and taken back with ⌘Z", async ({ page }) => {
  const { segment, quote } = seed()
  await page.goto("/")
  const entry = page.getByRole("button", { name: "Session", exact: true })
  await expect(entry).toBeVisible()
  await expect(page.locator("[data-sidebar=menu-badge][data-session-left]")).toHaveText("3")  // two cards, one challenge
  await entry.click()
  await expect(page.locator("[data-evening=done]")).toContainText("Made 3 cards")
  await expect(page.getByText("2 new · 1 challenge")).toBeVisible()
  await page.keyboard.press("Enter")

  // the first: right (the second option)
  await expect(page.getByText("첫 카드의 질문")).toBeVisible()
  await page.keyboard.press("2")
  await expect(page.locator("[data-answer=right]")).toContainText("Right.")
  await expect(page.locator("[data-answer=right]")).toContainText("Box 1 → 2 · back in 2 days")
  await expect(page.locator("[data-answer=right]")).toContainText(segment.target_text.slice(0, 10))
  await page.keyboard.press("Enter")

  // the second: wrong, then wrong again, then right — it comes back until it is
  await page.keyboard.press("1")
  await expect(page.locator("[data-answer=wrong]")).toContainText("Not this one — 4 is right.")
  await page.keyboard.press("Enter")
  await expect(page.getByText("Once more")).toBeVisible()
  await page.keyboard.press("2")
  await expect(page.locator("[data-answer=wrong]")).toBeVisible()
  await page.keyboard.press("Enter")
  await page.keyboard.press("4")
  await expect(page.locator("[data-answer=right]")).toContainText("Box 1 · tomorrow")
  await page.keyboard.press("Enter")
  const second = query<{ box: number; due_on: string }>("SELECT box, due_on FROM drill_card WHERE kind = 'nuance'")
  expect([second.box, second.due_on > TODAY]).toEqual([1, true])  // only the first answer moved it
  expect(query<{ n: number }>("SELECT count(*) AS n FROM drill_review").n).toBe(4)

  // the challenge: Claude's words in place of the translator's, the translator's write, undone with ⌘Z
  await expect(page.getByText("챌린지의 질문")).toBeVisible()
  await page.getByRole("button", { name: "Use the suggestion" }).click()
  await expect(page.getByText(/changed — ⌘Z undoes it/)).toBeVisible()
  const now = () => query<{ target_text: string }>("SELECT target_text FROM segment WHERE id = ?", segment.id).target_text
  expect(now()).toBe(segment.target_text.replace(quote, `${quote}(고침)`))
  await page.keyboard.press("Enter")
  await expect(page.getByText("Session done")).toBeVisible()
  await expect(page.getByText("2 cards — 1 right the first time, 1 back tomorrow")).toBeVisible()
  await expect(page.getByText("Challenges — 0 kept, 1 changed, 0 to discuss")).toBeVisible()
  await expect(page.locator("[data-sidebar=menu-badge][data-session-left]")).toHaveCount(0)  // nothing left today
  await page.keyboard.press("Meta+z")
  await expect.poll(now).toBe(segment.target_text)
  expect(query<{ status: string }>("SELECT status FROM drill_card WHERE kind = 'challenge'").status).toBe("active")
})

test("I know this takes a card out; Answer looks wrong sets it aside with Discuss with Claude", async ({ page }) => {
  seed()
  await page.goto("/")
  await page.getByRole("button", { name: "Session", exact: true }).click()
  await page.getByRole("button", { name: /Start/ }).click()
  await page.getByRole("button", { name: "I know this" }).click()
  await expect(page.getByText("둘째 카드의 질문")).toBeVisible()
  expect(query<{ status: string }>("SELECT status FROM drill_card WHERE kind = 'meaning'").status).toBe("known")
  await page.keyboard.press("1")
  await page.getByRole("button", { name: "Answer looks wrong" }).click()
  await expect(page.getByText("Set aside — this card won't come back.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Discuss with Claude" })).toBeVisible()
  expect(query<{ status: string }>("SELECT status FROM drill_card WHERE kind = 'nuance'").status).toBe("disputed")
})

/** Select two words of a read-only source paragraph that lie in one text node (marks split the text) and occur once
 *  in it, as a mouse drag would; returns them. */
async function selectSomeWords(p: Locator) {
  return p.evaluate((el) => {
    const all = el.textContent ?? ""
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? ""
      for (const m of text.matchAll(/[A-Za-z]{4,} [A-Za-z]{4,}/g)) {
        if (all.indexOf(m[0]) !== all.lastIndexOf(m[0])) continue
        const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length)
        const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r)
        return m[0]
      }
    }
    throw new Error("no two words to select")
  })
}

test("Add to Session: words picked from the source wait for the next run", async ({ page }) => {
  const { segment } = seed()
  await page.goto("/")
  await page.getByRole("button", { name: "Review", exact: true }).click()
  const { title } = query<{ title: string }>("SELECT title FROM chapter WHERE id = ?", segment.chapter_id)
  await page.getByRole("navigation", { name: "Chapters" }).getByTitle(title, { exact: true }).click()
  const row = page.locator(`[data-segment="${segment.id}"]`)
  await row.scrollIntoViewIfNeeded()
  const words = await selectSomeWords(row.locator("p").first())
  await page.locator("[data-floating-toolbar]").getByRole("button", { name: "Add to Session" }).click()
  await expect(page.getByText(`“${words}” will be in Session`)).toBeVisible()
  expect(query<{ quote: string; origin: string; run_id: number | null }>("SELECT quote, origin, run_id FROM drill_pick")).toEqual({ quote: words, origin: "picked", run_id: null })
})
