import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

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
