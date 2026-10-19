import { DatabaseSync } from "node:sqlite"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { execute } from "../../server/commands.mjs"

// Two writers, two ways back (docs/agent.md §18). The translator's changes go through the server as the editor makes
// them; Claude's are written straight into the e2e copy of the book (playwright.config.ts), as its fitz tool does,
// with a tool call id. Every test takes back what it wrote.
const API = "http://localhost:4801/api"
const E2E_DB = "/tmp/fitz-e2e.db"
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
const post = (request: APIRequestContext, name: string, data: unknown = {}) =>
  request.post(`${API}/${name}`, { data }).then(async (r) => { expect(r.ok(), await r.text()).toBe(true); return r.json() })
const iWrite = (request: APIRequestContext, id: number, text: string) => post(request, "updateSegment", { id, patch: { targetDoc: doc(text) } })
function claudeWrites(id: number, text: string, toolUseId: string) {
  const db = new DatabaseSync(E2E_DB, { timeout: 5000 })
  try { execute(db, "updateSegment", { id, targetDoc: doc(text), status: "draft" }, { actor: "agent", toolUseId }) } finally { db.close() }
}

async function open(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: /18: / }).click()
  await page.getByRole("tab", { name: "Translate" }).click()
  const pairs = page.locator("[data-pair]")
  await expect(pairs.nth(3)).toBeVisible()
  return { a: pairs.nth(2), b: pairs.nth(3), ids: [Number(await pairs.nth(2).getAttribute("data-pair")), Number(await pairs.nth(3).getAttribute("data-pair"))] }
}

test("⌘Z takes back your own change and passes over Claude's", async ({ page, request }) => {
  const { ids: [a, b] } = await open(page)
  await iWrite(request, a, "내가 쓴 번역")
  claudeWrites(b, "Claude가 쓴 번역", "toolu_e2e_pass")
  try {
    const { a: mine, b: claudes } = await open(page)
    await expect(claudes.locator("[data-target]")).toContainText("Claude가 쓴 번역")  // (¶b ends with a footnote marker)
    await page.getByRole("button", { name: "Undo" }).click()
    await expect(mine.locator("[data-target]")).not.toContainText("내가 쓴 번역")
    await expect(claudes.locator("[data-target]")).toContainText("Claude가 쓴 번역")
    await expect(page.locator("[data-sonner-toast]").getByText("Undone", { exact: true })).toBeVisible()
  } finally {
    await post(request, "undoClaude", { toolUseIds: ["toolu_e2e_pass"] })
    // and the translator's, if the test stopped before ⌘Z took it back
    const mine = (await post(request, "listSegments", { chapterId: (await post(request, "listChapters")).find((c: { title: string }) => /^18: /.test(c.title)).id }))
      .find((s: { id: number }) => s.id === a)
    if (mine.targetText.includes("내가 쓴 번역")) await post(request, "undo")
  }
})

test("⌘Z is refused, and says why, when Claude changed the same paragraph after you", async ({ page, request }) => {
  const { ids: [a] } = await open(page)
  await iWrite(request, a, "내가 쓴 번역")
  claudeWrites(a, "Claude가 그 위에 쓴 번역", "toolu_e2e_refused")
  try {
    const { a: pair } = await open(page)
    await expect(pair.locator("[data-target]")).toHaveText("Claude가 그 위에 쓴 번역")
    await page.keyboard.press("Meta+z")
    await expect(page.locator("[data-sonner-toast]").getByText("Can't undo", { exact: true })).toBeVisible()
    await expect(page.getByText(`Claude changed ¶${a} after this`)).toBeVisible()
    await expect(pair.locator("[data-target]")).toHaveText("Claude가 그 위에 쓴 번역")
    await expect(page.locator("footer [role=status]")).not.toHaveText("Save failed")
  } finally {
    await post(request, "undoClaude", { toolUseIds: ["toolu_e2e_refused"] })
    expect(await post(request, "undo")).toMatchObject({ actor: "translator" })  // now the translator's goes too
  }
})
