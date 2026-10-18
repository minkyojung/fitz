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

/** Select words inside a block, as a person dragging over them would. */
async function selectWords(block: import("@playwright/test").Locator, words: string) {
  await block.evaluate((el, w: string) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent!.indexOf(w)
      if (i === -1) continue
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length)
      const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r); return
    }
    throw new Error("not found: " + w)
  }, words)
}

test("Ask Claude on selected words: they wait in Claude's box, and go before the question with their paragraph", async ({ page }) => {
  const fake = await fakeServer(page)
  await page.goto("/")
  await page.getByRole("button", { name: /18: / }).click()
  await page.getByRole("tab", { name: "Translate" }).click()
  const pair = page.locator("[data-pair]").nth(2)
  const id = Number(await pair.getAttribute("data-pair"))
  await selectWords(pair.locator("p[lang=en]"), "The isthmus had changed")
  await page.locator("[data-floating-toolbar]").getByRole("button", { name: /Ask Claude/ }).click()

  await expect(page.getByRole("tab", { name: /Claude/ })).toHaveAttribute("aria-selected", "true")
  const box = page.getByRole("textbox", { name: "Message to Claude" })
  await expect(box).toBeFocused()
  await expect(page.locator("form [data-pointed]")).toContainText(`¶${id}`)
  await expect(page.locator("form [data-pointed]")).toContainText("“The isthmus had changed”")
  await box.fill("여기 changed greatly의 뉘앙스는?")
  await box.press("Enter")
  expect((await fake.last("send")).text).toBe(`¶${id} (English): “The isthmus had changed”\n\n여기 changed greatly의 뉘앙스는?`)
  await expect(page.locator("form [data-pointed]")).toHaveCount(0)
  await expect(thread(page).locator("[data-pointed]")).toContainText("“The isthmus had changed”")  // the sent message shows it too
})

test("⌘L does the same, from the text and from inside the open editor", async ({ page, request }) => {
  await fakeServer(page)
  await page.goto("/")
  await page.getByRole("button", { name: /18: / }).click()
  await page.getByRole("tab", { name: "Translate" }).click()
  const pair = page.locator("[data-pair]").nth(2)
  await selectWords(pair.locator("p[lang=en]"), "physical changes")
  await expect(page.locator("[data-floating-toolbar]")).toBeVisible()
  await page.keyboard.press("Meta+l")
  await expect(page.locator("form [data-pointed]")).toContainText("“physical changes”")
  await expect(page.getByRole("textbox", { name: "Message to Claude" })).toBeFocused()

  // what this part writes is taken back even if it fails halfway, so the next test finds the book as it was
  let saved = false
  try {
    await pair.locator("[data-target]").click()
    const editor = pair.getByRole("textbox", { name: "Edit translation" })
    await editor.pressSequentially("지협은 크게 변해 있었다")
    // Select as a person does, by keyboard, once the editor has taken the typing in: just after it gains focus,
    // ProseMirror puts back its own selection (20 ms later), so a selection made sooner than any hand could is lost.
    await expect(editor).toHaveText("지협은 크게 변해 있었다")
    // and wait for the app to have the whole selection, as a person's next key would
    await expect(async () => {
      await page.keyboard.press("End")
      for (let i = 0; i < " 있었다".length; i++) await page.keyboard.press("ArrowLeft")
      for (let i = 0; i < "크게 변해".length; i++) await page.keyboard.press("Shift+ArrowLeft")
      await expect(page.locator('[data-floating-toolbar][data-quote="크게 변해"]')).toBeVisible({ timeout: 1000 })
    }).toPass()
    await page.keyboard.press("Meta+l")
    await expect(page.locator("form [data-pointed]")).toContainText("“크게 변해”")
    // the cursor went to Claude's box, so the editor closed and kept what was written, as any click elsewhere does
    await expect(pair.locator("[data-target]")).toHaveText("지협은 크게 변해 있었다")
    saved = true
  } finally {
    const target = pair.locator("[data-target]")
    if (saved || ((await target.count()) && (await target.innerText()).includes("지협은"))) {
      expect((await request.post("http://localhost:4801/api/undo")).ok()).toBe(true)
      await expect(target).not.toContainText("지협은")
    }
  }
})
