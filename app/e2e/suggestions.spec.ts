import { DatabaseSync } from "node:sqlite"

import { expect, test, type APIRequestContext, type Page, type WebSocketRoute } from "@playwright/test"

// Claude's suggestions (docs/agent.md §4.1). They come in only from a task's answer, so these tests put them straight
// into the e2e copy of the book (playwright.config.ts) and take them out after; the run itself is played on the live
// connection. No Claude is involved.
const API = "http://localhost:4801/api"
const E2E_DB = "/tmp/fitz-e2e.db"
// the server reads and writes the same file meanwhile: wait for it rather than fail at once (SQLite's busy timeout)
const BUSY = { timeout: 5000 }
const CONV = "00000000-0000-4000-8000-0000000000e2"
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
const post = (request: APIRequestContext, name: string, data: unknown = {}) =>
  request.post(`${API}/${name}`, { data }).then(async (r) => { expect(r.ok(), await r.text()).toBe(true); return r.json() })
const translate = (request: APIRequestContext, id: number, text: string) => post(request, "updateSegment", { id, patch: { targetDoc: doc(text) } })

type Seed = { segmentId: number; side: "source" | "target"; quote: string; replacement: string; why?: string }
function seed(...rows: Seed[]): number[] {
  const db = new DatabaseSync(E2E_DB, BUSY)
  try {
    const version = db.prepare("SELECT version FROM segment WHERE id = ?")
    const insert = db.prepare(`INSERT INTO agent_suggestion(conversation_id, task, segment_id, side, quote, replacement, why, level, base_version)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    return rows.map((r) => Number(insert.run(CONV, r.side === "target" ? "review" : "typos", r.segmentId, r.side, r.quote, r.replacement,
      r.why ?? "시험용 제안", r.side === "target" ? "medium" : null, (version.get(r.segmentId) as { version: number }).version).lastInsertRowid))
  } finally { db.close() }
}
function unseed() {
  const db = new DatabaseSync(E2E_DB, BUSY)
  try { db.prepare("DELETE FROM agent_suggestion WHERE conversation_id = ?").run(CONV) } finally { db.close() }
}
test.afterEach(unseed)

/** The third paragraph of chapter 18, in the given view. */
async function open(page: Page, view: "Translate" | "Review") {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
  await page.getByRole("button", { name: view, exact: true }).click()
  const row = page.locator(view === "Translate" ? "[data-pair]" : "[data-segment]").nth(2)
  await expect(row).toBeVisible()
  return { row, id: Number(await row.getAttribute(view === "Translate" ? "data-pair" : "data-segment")) }
}
const card = (page: Page, id: number) => page.locator(`[data-panel-suggestion="${id}"]`)
/** The suggestions live under the head of Claude's panel, folded until opened. */
async function showSuggestions(page: Page) {
  const toggle = page.getByRole("button", { name: /^Suggestions/ })
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
}

test("a review suggestion only points; its card's Accept replaces the words, and ⌘Z brings back both", async ({ page, request }) => {
  const { id } = await open(page, "Translate")
  await translate(request, id, "제안을 시험하는 번역 문장입니다.")
  const [sid] = seed({ segmentId: id, side: "target", quote: "시험하는", replacement: "검사하는" })
  const { row } = await open(page, "Translate")
  const target = row.locator("[data-target]")
  const mark = target.locator(`[data-suggestion="${sid}"]`)
  await expect(mark.locator("mark")).toHaveText("시험하는")
  await expect(mark.locator("ins")).toHaveText("검사하는")

  // clicking it in the text selects its card, opening Claude's panel if it is closed; nothing changes and nothing opens
  // for editing
  const claudeButton = page.getByRole("button", { name: "Claude", exact: true })
  await claudeButton.click()
  await expect(claudeButton).toHaveAttribute("aria-pressed", "false")
  await mark.click()
  await expect(card(page, sid)).toHaveAttribute("data-selected", "true")
  await expect(mark).toHaveAttribute("data-selected", "true")
  await expect(row.getByRole("textbox", { name: "Edit translation" })).toHaveCount(0)
  await expect(claudeButton).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: /^Suggestions/ })).toHaveAttribute("aria-expanded", "true")

  await card(page, sid).getByRole("button", { name: "Accept" }).click()
  await expect(target).toHaveText("제안을 검사하는 번역 문장입니다.")
  await expect(card(page, sid)).toHaveCount(0)

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(mark.locator("mark")).toHaveText("시험하는")
  await expect(card(page, sid)).toBeVisible()
  await post(request, "undo")  // the translation this test wrote
})

test("Dismiss lets a suggestion go; Keep as comment leaves it as Claude's comment", async ({ page, request }) => {
  const { id } = await open(page, "Translate")
  await translate(request, id, "첫째 구절과 둘째 구절이 있는 번역입니다.")
  const [dismissed, kept] = seed(
    { segmentId: id, side: "target", quote: "첫째 구절", replacement: "처음 구절" },
    { segmentId: id, side: "target", quote: "둘째 구절", replacement: "다음 구절", why: "더 자연스럽습니다" },
  )
  const { row } = await open(page, "Translate")
  await showSuggestions(page)
  await expect(page.locator("[data-open-suggestions]")).toHaveText("2")

  await card(page, dismissed).getByRole("button", { name: "Dismiss" }).click()
  await expect(card(page, dismissed)).toHaveCount(0)
  await expect(row.locator(`[data-suggestion="${dismissed}"]`)).toHaveCount(0)
  await expect(row.locator("[data-target]")).toContainText("첫째 구절과")

  await card(page, kept).getByRole("button", { name: "Keep as comment" }).click()
  await expect(card(page, kept)).toHaveCount(0)
  await expect(page.locator("[data-open-suggestions]")).toHaveText("0")
  await row.locator("[data-target] mark[data-comment]").click()
  const comment = page.locator("[data-thread]").filter({ hasText: "더 자연스럽습니다" })
  await expect(comment.locator("[data-author=agent]")).toHaveText("Claude")
  await expect(comment).toContainText("둘째 구절 → 다음 구절")

  for (let i = 0; i < 3; i++) await post(request, "undo")  // the comment, the dismissal, the translation
})

test("a suggestion whose words changed since is not shown in the text and cannot be accepted", async ({ page, request }) => {
  const { id } = await open(page, "Translate")
  await translate(request, id, "바뀌기 전의 번역입니다.")
  const [sid] = seed({ segmentId: id, side: "target", quote: "바뀌기 전의", replacement: "예전" })
  await translate(request, id, "이미 다시 쓴 번역입니다.")
  const { row } = await open(page, "Translate")
  await showSuggestions(page)
  await expect(card(page, sid).locator("[data-stale]")).toBeVisible()
  await expect(card(page, sid).getByRole("button", { name: "Accept" })).toBeDisabled()
  await expect(row.locator("[data-suggestion]")).toHaveCount(0)
  await post(request, "undo")
  await post(request, "undo")
})

test("an OCR suggestion is shown on the source in Review, and accepting it fixes the source", async ({ page }) => {
  const { id } = await open(page, "Review")
  const db = new DatabaseSync(E2E_DB, { readOnly: true, ...BUSY })
  const source = (db.prepare("SELECT source_text FROM segment WHERE id = ?").get(id) as { source_text: string }).source_text
  db.close()
  // the first few words, lengthened until they occur only once
  let quote = source.split(" ").slice(0, 2).join(" ")
  for (let n = 3; source.indexOf(quote, source.indexOf(quote) + 1) !== -1; n++) quote = source.split(" ").slice(0, n).join(" ")
  const [sid] = seed({ segmentId: id, side: "source", quote, replacement: `${quote}§` })
  const { row } = await open(page, "Review")
  const mark = row.locator(`[data-suggestion="${sid}"]`)
  await expect(mark.locator("mark")).toHaveText(quote)
  await mark.click()
  await expect(card(page, sid)).toHaveAttribute("data-selected", "true")
  await expect(card(page, sid).getByRole("button", { name: "Keep as comment" })).toHaveCount(0)
  await card(page, sid).getByRole("button", { name: "Accept" }).click()
  await expect(mark).toHaveCount(0)  // before, the replacement showed beside the struck words; now it is the text
  await expect(row.locator("p").first()).toContainText(`${quote}§`)
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(mark.locator("mark")).toHaveText(quote)
})

test("starting a review shows Claude at work, then what it found", async ({ page, request }) => {
  // the page's live connection passes through here; a task's start is answered as the server would, without Claude
  let live: WebSocketRoute | null = null
  const started: { convId: string; task: string; chapterId: number }[] = []
  await page.routeWebSocket("**/live", (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => { const msg = JSON.parse(String(m)); if (msg.type === "start") started.push(msg); else server.send(m) })
    live = ws
  })
  const { id } = await open(page, "Translate")
  await translate(request, id, "Claude가 읽을 번역입니다.")
  const { row } = await open(page, "Translate")
  await showSuggestions(page)
  await page.getByRole("button", { name: "Review this chapter with Claude" }).click()
  await expect(page.locator("[data-run]")).toContainText("Claude is reading the chapter…")
  await expect.poll(() => started.length).toBe(1)
  expect(started[0].task).toBe("review")

  const [sid] = seed({ segmentId: id, side: "target", quote: "읽을", replacement: "검토할" })
  live!.send(JSON.stringify({ type: "suggested", segmentIds: [id] }))
  live!.send(JSON.stringify({ type: "message", convId: started[0].convId, message: { type: "result", subtype: "success", terminal_reason: "completed", is_error: false } }))
  await expect(page.locator("[data-run]")).toHaveAttribute("data-run", "done")
  await expect(card(page, sid)).toBeVisible()
  await expect(row.locator(`[data-suggestion="${sid}"] ins`)).toHaveText("검토할")
  await expect(page.locator("[data-run]")).toContainText("1 suggestion")
  await post(request, "undo")
})
