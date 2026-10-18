import { DatabaseSync } from "node:sqlite"

import { expect, test, type APIRequestContext, type Page, type WebSocketRoute } from "@playwright/test"

// The book has two writers: this editor and another (the translation agent, another window). Here the other writer
// is the test calling the server directly, through the same updateSegment the agent's set_translation uses.
const API = "http://localhost:4801/api"
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
const otherWrites = (request: APIRequestContext, id: number, text: string) =>
  request.post(`${API}/updateSegment`, { data: { id, patch: { targetDoc: doc(text) } } }).then((r) => expect(r.ok()).toBe(true))
const undoOnServer = (request: APIRequestContext) => request.post(`${API}/undo`).then((r) => expect(r.ok()).toBe(true))

async function openChapter(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: /18: / }).click()
  await page.getByRole("tab", { name: "Translate" }).click()
  const pair = page.locator("[data-pair]").nth(2)
  await expect(pair).toBeVisible()
  return { pair, id: Number(await pair.getAttribute("data-pair")) }
}

test("what another writer does shows up without reloading", async ({ page, request }) => {
  const { pair, id } = await openChapter(page)
  await otherWrites(request, id, "다른 쪽이 쓴 번역")
  await expect(pair.locator("[data-target]")).toContainText("다른 쪽이 쓴 번역")
  await undoOnServer(request)
  await expect(pair.locator("[data-target]")).not.toContainText("다른 쪽이 쓴 번역")
})

test("⌘Enter while another writer changed the paragraph: nothing is overwritten, and what you wrote is kept to recover", async ({ page, request }) => {
  const { pair, id } = await openChapter(page)
  await pair.locator("[data-target]").click()
  await expect(pair.getByRole("textbox", { name: "Edit translation" })).toBeFocused()
  await page.keyboard.type("내가 쓰던 번역")
  await otherWrites(request, id, "에이전트가 쓴 번역")
  await page.keyboard.press("Meta+Enter")

  await expect(page.getByText("This paragraph changed meanwhile")).toBeVisible()
  await expect(pair.locator("[data-target]")).toContainText("에이전트가 쓴 번역")
  const unsaved = pair.locator("[data-unsaved]")
  await expect(unsaved).toContainText("the paragraph changed since")
  await expect(pair.locator("[data-status]")).not.toHaveAttribute("data-status", "reviewed")

  // recovering is the translator's choice: it opens what they wrote, and saving it now is deliberate
  await unsaved.getByRole("button", { name: "Recover" }).click()
  await expect(pair.getByRole("textbox", { name: "Edit translation" })).toContainText("내가 쓰던 번역")
  await expect(pair.getByRole("textbox", { name: "Edit translation" })).toBeFocused()
  await page.keyboard.press("Meta+Enter")
  await expect(pair.locator("[data-target]")).toContainText("내가 쓰던 번역")
  await expect(pair.locator("[data-unsaved]")).toHaveCount(0)
  await expect(page.locator("footer [role=status]")).toHaveText("Saved")

  await undoOnServer(request)
  await undoOnServer(request)
})

test("saving with Tab after another writer changed the paragraph keeps your text too", async ({ page, request }) => {
  const { pair, id } = await openChapter(page)
  await pair.locator("[data-target]").click()
  await page.keyboard.type("탭으로 저장하려던 글")
  await otherWrites(request, id, "그사이 들어온 글")
  await page.keyboard.press("Tab")

  await expect(pair.locator("[data-target]")).toContainText("그사이 들어온 글")
  await expect(pair.locator("[data-unsaved]")).toContainText("the paragraph changed since")
  await pair.locator("[data-unsaved]").getByRole("button", { name: "Discard" }).click()
  await expect(pair.locator("[data-unsaved]")).toHaveCount(0)
  await undoOnServer(request)
})

// The agent's comments come in only through its fitz tool (there is no HTTP door for "agent"), so this test puts one
// straight into the e2e copy of the book (playwright.config.ts) to see how the editor shows it, and takes it out after.
const E2E_DB = "/tmp/fitz-e2e.db"

test("a comment Claude left says so in the notes panel; the translator's does not", async ({ page }) => {
  const { id } = await openChapter(page)
  const db = new DatabaseSync(E2E_DB)
  const insert = db.prepare("INSERT INTO comment(segment_id, side, body, author) VALUES (?, 'source', ?, ?)")
  const mine = Number(insert.run(id, "번역자의 메모", "translator").lastInsertRowid)
  const claudes = Number(insert.run(id, "Claude가 남긴 메모", "agent").lastInsertRowid)
  try {
    await page.reload()
    await page.getByRole("button", { name: /18: / }).click()
    await page.getByRole("tab", { name: "Translate" }).click()
    await page.locator(`[data-pair="${id}"]`).click()
    await page.getByRole("tab", { name: /Notes/ }).click()
    const claude = page.locator(`[data-panel-comment="${claudes}"]`)
    await expect(claude).toContainText("Claude가 남긴 메모")
    await expect(claude.locator("[data-author=agent]")).toHaveText("Claude")
    const translator = page.locator(`[data-panel-comment="${mine}"]`)
    await expect(translator).toContainText("번역자의 메모")
    await expect(translator.locator("[data-author]")).toHaveCount(0)
  } finally {
    db.prepare("DELETE FROM comment WHERE id IN (?, ?)").run(mine, claudes)
    db.close()
  }
})

test("when the live connection drops, the editor reconnects by itself and shows what changed meanwhile", async ({ page, request }) => {
  // every /live connection the page makes passes through here to the real server, so the test can drop one
  const connections: WebSocketRoute[] = []
  await page.routeWebSocket("**/live", (ws) => { ws.connectToServer(); connections.push(ws) })
  const { pair, id } = await openChapter(page)
  await expect.poll(() => connections.length).toBe(1)

  await connections[0].close()
  await otherWrites(request, id, "끊긴 사이에 쓴 번역")
  expect(connections.length, "written while the page had no connection: the change cannot reach it as an event").toBe(1)

  await expect.poll(() => connections.length).toBe(2)  // it came back by itself
  await expect(pair.locator("[data-target]")).toContainText("끊긴 사이에 쓴 번역")  // and caught up on what it missed

  await otherWrites(request, id, "다시 붙은 뒤의 번역")
  await expect(pair.locator("[data-target]")).toContainText("다시 붙은 뒤의 번역")
  await undoOnServer(request)
  await undoOnServer(request)
})
