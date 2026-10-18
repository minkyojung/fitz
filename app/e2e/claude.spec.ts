import { readFileSync } from "node:fs"

import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"

import { foldMessages, type SdkMessage } from "../../server/agent/fold.mjs"

// The conversation with Claude in the editor (docs/agent.md §17), played from recorded real sessions over the page's
// live connection. The test answers for the server about conversations, so no Claude runs and the book is untouched;
// everything else the page says still reaches the real server.
const recording = (name: string): SdkMessage[] =>
  readFileSync(new URL(`../../server/agent/fixtures/${name}.jsonl`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const nuance = recording("nuance")
const translate = recording("translate")
const CONVERSATION = ["start", "send", "stop", "answer", "list", "open"]

type Said = { type: string; convId?: string; [k: string]: unknown }
async function fakeServer(page: Page) {
  const said: Said[] = []
  let live: WebSocketRoute | null = null
  await page.routeWebSocket("**/live", (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m)) as Said
      if (CONVERSATION.includes(msg.type)) said.push(msg)
      else server.send(m)
    })
    live = ws
  })
  const tell = (event: object) => live!.send(JSON.stringify(event))
  const play = (convId: string, frames: SdkMessage[]) => { for (const message of frames) tell({ type: "message", convId, message }) }
  const last = async (type: string) => { await expect.poll(() => said.some((m) => m.type === type)).toBe(true); return said.filter((m) => m.type === type).at(-1)! }
  return { said, tell, play, last }
}

async function openClaude(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: /18: / }).click()
  await page.getByRole("tab", { name: "Translate" }).click()
  await page.getByRole("tab", { name: /Claude/ }).click()
  return page.getByRole("textbox", { name: "Message to Claude" })
}
const thread = (page: Page) => page.getByLabel("Conversation with Claude")

test("a question begins a conversation; what Claude read, thought and answered comes back, then how long and how much", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await expect(thread(page)).toContainText("Ask about this chapter")
  await box.fill("이 문장 뉘앙스는?")
  await box.press("Enter")

  const start = await fake.last("start")
  expect(start).toMatchObject({ model: "claude-opus-5-5", effort: "medium" })
  expect(await fake.last("send")).toEqual({ type: "send", convId: start.convId, text: "이 문장 뉘앙스는?" })
  await expect(box).toHaveValue("")
  await expect(thread(page)).toContainText("Starting")  // until Claude Code echoes the message
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()

  fake.tell({ type: "snapshot", convId: start.convId, state: foldMessages([]), asks: [] })
  fake.play(start.convId!, nuance)
  await expect(thread(page)).toContainText("Read ¶4 and 3 around")
  await expect(thread(page).getByRole("button", { name: "Thought" })).toBeVisible()
  await expect(thread(page).getByRole("heading", { name: "뜻과 뉘앙스" })).toBeVisible()  // Claude's markdown, rendered
  await expect(thread(page)).toContainText("21s · $0.039")
  await expect(thread(page)).not.toContainText("Starting")
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
  await expect(page.locator("[data-conversation-title]")).toContainText("¶4의 'unusually communicative")
  await expect(page.getByRole("button", { name: /^Suggestions/ })).toBeInViewport()  // a long title gives way
  await expect(page.getByText("Opus 5.5 · medium")).toBeVisible()  // what it began with, no longer a choice
})

test("a write Claude asks for waits on a card; Allow goes to the server and the card becomes a line", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("¶3을 번역해서 넣어줘")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [] })
  const asking = translate.findIndex((m) => m.type === "system" && m.subtype === "session_state_changed" && m.state === "requires_action")
  fake.play(convId!, translate.slice(0, asking + 1))
  const call = translate.flatMap((m) => (m.type === "assistant" ? (m.message as { content: { type: string; name?: string; input?: { text: string } }[] }).content : []))
    .find((b) => b.type === "tool_use" && b.name?.endsWith("set_translation"))!
  const ask = { requestId: "8d0f3c1e-2a4b-4c6d-8e0f-1a2b3c4d5e6f", tool: "set_translation", input: call.input, preview: { summary: "Write the translation of ¶3", segmentId: 3, before: null, after: call.input!.text } }
  fake.tell({ type: "ask", convId, ask })

  const card = page.locator(`[data-ask="${ask.requestId}"]`)
  await expect(card).toContainText("Write the translation of ¶3?")
  await expect(thread(page)).toContainText("Waiting for your answer")
  await expect(page.getByRole("tab", { name: /Claude/ }).locator("[data-slot=badge]")).toHaveText("1")
  await expect(card).toContainText("누군가를 비판하고 싶어질 때면")
  await card.getByRole("button", { name: "Allow" }).click()
  expect(await fake.last("answer")).toEqual({ type: "answer", convId, requestId: ask.requestId, decision: "allow" })

  fake.tell({ type: "asked", convId, requestId: ask.requestId, decision: "allow" })
  fake.play(convId!, translate.slice(asking + 1))
  await expect(card).toHaveCount(0)
  await expect(thread(page)).toContainText("Wrote the translation of ¶3")
  await expect(thread(page)).toContainText("14s · $0.062")
})

test("Stop goes to the server while Claude works", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("뉘앙스?")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [] })
  fake.play(convId!, nuance.slice(0, 100))
  await expect(thread(page)).toContainText("Read ¶4 and 3 around")
  await page.getByRole("button", { name: "Stop" }).click()
  expect(await fake.last("stop")).toEqual({ type: "stop", convId })
})

test("past conversations are listed (not the review's), and one opens as it was, with its own model", async ({ page }) => {
  const fake = await fakeServer(page)
  await openClaude(page)
  const item = (id: string, title: string, task: string | null) =>
    ({ id, sessionId: "s", title, model: "claude-sonnet-5-5", effort: "low", task, chapterId: task ? 19 : null, createdAt: "2026-10-18 10:00:00", usedAt: "2026-10-18 10:00:00" })
  const past = "4c9d7a1b-3e5f-4a2b-9c8d-7e6f5a4b3c2d"
  await page.locator("[data-conversation-title]").click()
  await fake.last("list")
  fake.tell({ type: "conversations", items: [item(past, "Reserved 뉘앙스", null), item("5c9d7a1b-3e5f-4a2b-9c8d-7e6f5a4b3c2d", "Chapter review", "review")] })
  await expect(page.getByRole("menuitem", { name: /Reserved 뉘앙스/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /Chapter review/ })).toHaveCount(0)
  await page.getByRole("menuitem", { name: /Reserved 뉘앙스/ }).click()

  expect(await fake.last("open")).toEqual({ type: "open", convId: past })
  fake.tell({ type: "snapshot", convId: past, state: foldMessages(nuance), asks: [] })
  await expect(thread(page).getByRole("heading", { name: "뜻과 뉘앙스" })).toBeVisible()
  await expect(page.locator("[data-conversation-title]")).toHaveText("Reserved 뉘앙스")
  await expect(page.getByText("Sonnet 5.5 · low")).toBeVisible()  // its own, no longer a choice

  await page.locator("[data-conversation-title]").click()
  await page.getByRole("menuitem", { name: "New conversation" }).click()
  await expect(thread(page)).toContainText("Ask about this chapter")
  await expect(page.getByRole("button", { name: /Opus 5.5 · medium/ })).toBeVisible()
})
