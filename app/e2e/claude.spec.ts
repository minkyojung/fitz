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
const websearch = recording("websearch")
const CONVERSATION = ["start", "send", "stop", "answer", "list", "open", "configure", "context", "compact"]

type Said = { type: string; convId?: string; [k: string]: unknown }
async function fakeServer(page: Page) {
  const said: Said[] = []
  let live: WebSocketRoute | null = null
  // the conversations a list is answered with, at once as the server does (the page lists them on load too)
  let conversations: object[] = []
  await page.routeWebSocket("**/live", (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m)) as Said
      if (msg.type === "list") ws.send(JSON.stringify({ type: "conversations", items: conversations }))
      if (CONVERSATION.includes(msg.type)) said.push(msg)
      else server.send(m)
    })
    live = ws
  })
  const tell = (event: object) => live!.send(JSON.stringify(event))
  const play = (convId: string, frames: SdkMessage[]) => { for (const message of frames) tell({ type: "message", convId, message }) }
  const last = async (type: string) => { await expect.poll(() => said.some((m) => m.type === type)).toBe(true); return said.filter((m) => m.type === type).at(-1)! }
  return { said, tell, play, last, list: (items: object[]) => { conversations = items } }
}

async function openClaude(page: Page) {
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
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
  await expect(thread(page).locator("[data-turn-end]")).toHaveText("21s")  // how long; not the cost, an estimate on a subscription
  // the turn's end sits under the answer, at its left edge, not squeezed beside it
  const end = (await thread(page).locator("[data-turn-end]").boundingBox())!
  const answer = (await thread(page).getByRole("heading", { name: "뜻과 뉘앙스" }).boundingBox())!
  expect(end.y).toBeGreaterThan(answer.y + answer.height)
  expect(Math.abs(end.x - answer.x)).toBeLessThan(4)
  await expect(thread(page)).not.toContainText("Starting")
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
  await expect(page.locator("[data-conversation-title]")).toContainText("¶4의 'unusually communicative")
  await expect(page.getByRole("button", { name: /^Suggestions/ })).toBeInViewport()  // a long title gives way
  await expect(page.getByRole("button", { name: /Opus 5.5 · medium/ })).toBeVisible()  // what it began with
})

test("between turns the model and effort can change; the menu shows what the server says, and is shut while Claude answers", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("이 문장 뉘앙스는?")
  await box.press("Enter")
  const start = await fake.last("start")
  const menu = page.getByRole("button", { name: /Opus 5.5 · medium/ })
  await expect(menu).toBeDisabled()  // until Claude Code echoes the message, and while it answers
  fake.tell({ type: "snapshot", convId: start.convId, state: foldMessages([]), asks: [], model: "claude-opus-5-5", effort: "medium" })
  fake.play(start.convId!, nuance)
  await expect(thread(page).locator("[data-turn-end]")).toHaveText("21s")
  await expect(menu).toBeEnabled()

  await menu.click()
  await page.getByRole("menuitemradio", { name: "Sonnet 5.5" }).click()
  expect(await fake.last("configure")).toEqual({ type: "configure", convId: start.convId, model: "claude-sonnet-5-5" })
  await page.keyboard.press("Escape")
  await expect(menu).toBeVisible()  // not changed until the server says so
  fake.tell({ type: "configured", convId: start.convId, model: "claude-sonnet-5-5", effort: "medium" })
  const changed = page.getByRole("button", { name: /Sonnet 5.5 · medium/ })
  await expect(changed).toBeVisible()

  await changed.click()
  await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
  await expect.poll(() => fake.said.filter((m) => m.type === "configure").length).toBe(2)
  expect(await fake.last("configure")).toEqual({ type: "configure", convId: start.convId, effort: "high" })
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
  // the panel closed, its button in the header says Claude waits; opened again, the card is there
  const claudeButton = page.getByRole("button", { name: "Claude", exact: true })
  await claudeButton.click()
  await expect(claudeButton).toHaveAttribute("aria-pressed", "false")
  await expect(claudeButton.locator("[data-attention]")).toBeVisible()
  await claudeButton.click()
  await expect(claudeButton).toHaveAttribute("aria-pressed", "true")
  await expect(card).toContainText("누군가를 비판하고 싶어질 때면")
  await card.getByRole("button", { name: "Allow" }).click()
  expect(await fake.last("answer")).toEqual({ type: "answer", convId, requestId: ask.requestId, decision: "allow" })

  fake.tell({ type: "asked", convId, requestId: ask.requestId, decision: "allow" })
  fake.play(convId!, translate.slice(asking + 1))
  await expect(card).toHaveCount(0)
  await expect(thread(page)).toContainText("Wrote the translation of ¶3")
  await expect(thread(page).locator("[data-turn-end]")).toContainText("14s")
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

test("each web search is a line with what Claude searched for, and the answer names its sources", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("¶2의 국내 번역본들?")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [] })
  fake.play(convId!, websearch)
  const queries = foldMessages(websearch).items.flatMap((i) => (i.kind === "tool" && i.name === "WebSearch" ? [String(i.input.query)] : []))
  expect(queries).toHaveLength(3)
  for (const q of queries) await expect(thread(page)).toContainText(`Searched the web for “${q}”`)
  await expect(thread(page)).toContainText("NYCultureBeat")
  await expect(thread(page).locator("[data-turn-end]")).toHaveText("63s")
})

test("past conversations are listed (not the review's), and one opens as it was, with its own model", async ({ page }) => {
  const fake = await fakeServer(page)
  await openClaude(page)
  const item = (id: string, title: string, task: string | null) =>
    ({ id, sessionId: "s", title, model: "claude-sonnet-5-5", effort: "low", task, chapterId: task ? 19 : null, createdAt: "2026-10-18 10:00:00", usedAt: "2026-10-18 10:00:00", working: false })
  const past = "4c9d7a1b-3e5f-4a2b-9c8d-7e6f5a4b3c2d"
  fake.list([item(past, "Reserved 뉘앙스", null), item("5c9d7a1b-3e5f-4a2b-9c8d-7e6f5a4b3c2d", "Chapter review", "review")])
  await page.locator("[data-conversation-title]").click()
  await expect(page.getByRole("menuitem", { name: /Reserved 뉘앙스/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /Chapter review/ })).toHaveCount(0)
  await page.getByRole("menuitem", { name: /Reserved 뉘앙스/ }).click()

  expect(await fake.last("open")).toEqual({ type: "open", convId: past })
  fake.tell({ type: "snapshot", convId: past, state: foldMessages(nuance), asks: [] })
  await expect(thread(page).getByRole("heading", { name: "뜻과 뉘앙스" })).toBeVisible()
  await expect(page.locator("[data-conversation-title]")).toHaveText("Reserved 뉘앙스")
  await expect(page.getByRole("button", { name: /Sonnet 5.5 · low/ })).toBeVisible()  // its own

  await page.locator("[data-conversation-title]").click()
  await page.getByRole("menuitem", { name: "New conversation" }).click()
  await expect(thread(page)).toContainText("Ask about this chapter")
  await expect(page.getByRole("button", { name: /Opus 5.5 · medium/ })).toBeVisible()
})

test("the title Claude Code gives the conversation shows in the header once the server keeps it, the menu unopened (docs/agent.md §23)", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("이 문장 뉘앙스는?")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [], title: null })
  fake.play(convId!, nuance)
  const title = page.locator("[data-conversation-title]")
  await expect(title).toContainText("¶4의 'unusually communicative")  // its first message, until it has a title
  fake.tell({ type: "titled", convId, title: "Reserved 뉘앙스" })
  await expect(title).toHaveText("Reserved 뉘앙스")
})

test("the words typed, the model button's words and the Send button keep to one edge, 16px in (docs/agent.md §25)", async ({ page }) => {
  await fakeServer(page)
  const box = await openClaude(page)
  const edges = await box.evaluate((area) => {
    const group = area.closest("[data-slot=input-group]")!
    const frame = group.getBoundingClientRect()
    const r = area.getBoundingClientRect()
    const css = getComputedStyle(area)
    const model = [...group.querySelectorAll("button")].find((b) => b.textContent?.includes(" · "))!
    const words = document.createRange()
    words.selectNodeContents(model.firstChild!)
    return {
      text: r.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft) - frame.left,
      textEnd: frame.right - (r.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight)),
      model: words.getBoundingClientRect().left - frame.left,
      send: frame.right - group.querySelector("[aria-label=Send]")!.getBoundingClientRect().right,
    }
  })
  expect(edges.model).toBeCloseTo(edges.text, 0)  // a ghost button's words, where the box has none
  expect(edges.send).toBeCloseTo(edges.textEnd, 0)  // a boxed button's box
  expect(edges.text).toBeCloseTo(17, 0)  // the frame's 1px and 16px
})

test("from Enter to the answer one live line shows Claude at work, its time from the turn's start, its thought as it streams (docs/agent.md §26)", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("이 문장 뉘앙스는?")
  await box.press("Enter")
  const line = page.locator("[data-live-line]")
  await expect(thread(page)).toContainText("Starting")  // before Claude Code echoes it

  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [], working: false, startedAt: null })
  fake.tell({ type: "started", convId, startedAt: Date.now() - 3_000 })
  const at = (kind: string, from = 0) => nuance.findIndex((m, i) => i >= from && (m.type === kind || (m.type === "stream_event" && (m as { event: { type: string; delta?: { type: string } } }).event.delta?.type === kind)))
  const echo = nuance.findIndex((m) => m.type === "user" && (m as { isReplay?: boolean }).isReplay)
  fake.play(convId!, nuance.slice(0, echo + 1))
  await expect(thread(page)).toContainText("Thinking")  // echoed, nothing of Claude's come yet: the gap there was
  await expect(line).toContainText("Thinking")
  await expect(line.locator("[data-slot=trace-description]")).toHaveText(/^([3-9]|\d\d)\.\ds$/)  // from the server's start, not from now
  await line.evaluate((el) => { (el as HTMLElement & { kept?: boolean }).kept = true })

  const toolDone = at("assistant", echo)
  fake.play(convId!, nuance.slice(echo + 1, toolDone))
  await expect(line).toContainText("Reading")  // the first block streams: a call to read
  const thinking = at("thinking_delta", toolDone)
  fake.play(convId!, nuance.slice(toolDone, thinking + 5))
  await expect(line).toContainText("Thinking")
  await expect(page.locator("[data-thought-stream]")).toContainText("I'm thinking about this Gatsby line")
  expect(await line.evaluate((el) => (el as HTMLElement & { kept?: boolean }).kept)).toBe(true)  // the same line throughout

  fake.play(convId!, nuance.slice(thinking + 5))
  await expect(line).toHaveCount(0)
  await expect(thread(page).locator("[data-turn-end]")).toContainText("21s")
})

test("Claude's answer reads by Octave's rules at 15px: paragraphs apart, headings above the text, markers outside, quotes upright, Korean words whole (docs/agent.md §27)", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("이 문장 뉘앙스는?")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [] })
  fake.play(convId!, nuance)
  const heading = thread(page).getByRole("heading", { name: "뜻과 뉘앙스" })
  await expect(heading).toBeVisible()
  const read = await heading.evaluate((h) => {
    const words = h.closest("[lang=ko]")!  // the answer
    const css = (el: Element) => getComputedStyle(el)
    const p = [...words.querySelectorAll("p")].find((x) => x.nextElementSibling?.tagName === "P" || x.nextElementSibling?.tagName === "UL")!
    const probe = document.body.appendChild(document.createElement("span"))
    probe.style.color = "var(--answer)"
    const answerColor = css(probe).color
    probe.remove()
    return {
      size: css(p).fontSize, wordBreak: css(p).wordBreak, color: css(p).color, answerColor, bodyColor: css(document.body).color,
      gap: p.nextElementSibling!.getBoundingClientRect().top - p.getBoundingClientRect().bottom,
      heading: parseFloat(css(words.querySelector("h2")!).fontSize),
      markers: css(words.querySelector("ul")!).listStylePosition,
      quote: css(words.querySelector("blockquote")!).fontStyle,
    }
  })
  expect(read.size).toBe("15px")
  expect(read.wordBreak).toBe("keep-all")
  expect(read.gap).toBeCloseTo(16, 0)
  expect(read.heading).toBeGreaterThan(15)
  expect(read.markers).toBe("outside")
  expect(read.quote).toBe("normal")
  expect(read.answerColor).not.toBe(read.bodyColor)  // a softer black than the app's text
  expect(read.color).toBe(read.answerColor)
})

test("why Claude stopped is said: not logged in at the turn's end, retrying on the live line (docs/agent.md §29)", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("안녕?")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [] })
  const echo = nuance.findIndex((m) => m.type === "user" && (m as { isReplay?: boolean }).isReplay)
  fake.play(convId!, nuance.slice(0, echo + 1))
  fake.tell({ type: "message", convId, message: { type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 8000, error_status: 529, error: "overloaded", uuid: "r1", session_id: "s" } })
  await expect(page.locator("[data-live-line]")).toContainText("Retrying 2/10 · overloaded")
  fake.play(convId!, nuance.slice(echo + 1))
  await expect(page.locator("[data-live-line]")).toHaveCount(0)

  await box.fill("또 안녕?")
  await box.press("Enter")
  fake.play(convId!, recording("nologin").filter((m) => m.type !== "system" || (m as { subtype?: string }).subtype !== "init"))
  await expect(thread(page).locator("[data-turn-end]").last()).toContainText("Not logged in — run `claude /login` in a terminal")
})

test("the models and efforts offered are what Claude Code told the server; its own list until then (docs/agent.md §31)", async ({ page }) => {
  // the fake server answers the page's "models" as the real one does: nothing known at first, then the list
  const offered = [
    { id: "claude-opus-5-5", name: "Opus 5.5", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { id: "claude-fable-5-1", name: "Fable 5.1", efforts: ["low", "medium", "high", "xhigh", "max"] },
    { id: "claude-haiku-5-5", name: "Haiku 5.5", efforts: ["low", "medium", "high"] },
  ]
  let known: typeof offered | null = null
  await page.routeWebSocket("**/live", (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m))
      if (msg.type === "models") ws.send(JSON.stringify({ type: "models", items: known }))
      else if (msg.type === "list") ws.send(JSON.stringify({ type: "conversations", items: [] }))
      else if (!["start", "send", "open", "configure"].includes(msg.type)) server.send(m)
    })
  })
  await openClaude(page)
  const menu = page.getByRole("button", { name: /Opus 5.5 · medium/ })
  await menu.click()
  await expect(page.getByRole("menuitemradio", { name: "Sonnet 5.5" })).toBeVisible()  // the page's own list, until the server says
  await expect(page.getByRole("menuitemradio", { name: "Fable 5.1" })).toHaveCount(0)
  await expect(page.getByRole("menuitemradio", { name: "max" })).toHaveCount(0)
  await page.keyboard.press("Escape")

  known = offered
  await page.reload()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  await page.getByRole("button", { name: /Opus 5.5 · medium/ }).click()
  await expect(page.getByRole("menuitemradio", { name: "Fable 5.1" })).toBeVisible()
  await expect(page.getByRole("menuitemradio", { name: "Sonnet 5.5" })).toHaveCount(0)
  await expect(page.getByRole("menuitemradio", { name: "max" })).toBeVisible()  // Opus takes five efforts
  await page.getByRole("menuitemradio", { name: "Haiku 5.5" }).click()
  await page.getByRole("button", { name: /Haiku 5.5 · medium/ }).click()
  await expect(page.getByRole("menuitemradio", { name: "max" })).toHaveCount(0)  // Haiku, as the server said, three
  await expect(page.getByRole("menuitemradio", { name: "high", exact: true })).toBeVisible()
})

test("a compaction shows as Compacting, then a Compacted line with the counts; the summary and the command are not the translator's (docs/agent.md §32)", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("¶4를 읽고 한 줄로 요약해.")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [] })
  const compact = recording("compact")
  const compacting = compact.findIndex((m) => m.type === "system" && (m as { status?: string }).status === "compacting")
  fake.play(convId!, compact.slice(0, compacting + 1))
  await expect(page.locator("[data-live-line]")).toContainText("Compacting")
  fake.play(convId!, compact.slice(compacting + 1))
  const { pre_tokens, post_tokens } = (compact.find((m) => m.type === "system" && (m as { subtype?: string }).subtype === "compact_boundary") as { compact_metadata: { pre_tokens: number; post_tokens: number } }).compact_metadata
  await expect(thread(page).locator("[data-compacted]")).toHaveText(`Compacted ${(pre_tokens / 1000).toFixed(1)}k → ${(post_tokens / 1000).toFixed(1)}k`)
  await expect(thread(page)).not.toContainText("This session is being continued")
  await expect(thread(page)).not.toContainText("command-name")
  await expect(thread(page).locator("[data-turn-end]")).toHaveCount(2)
})

test("the Context window: how full as the server says, the plan's windows from the turn, and Compact asks the server (docs/agent.md §32)", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await expect(page.getByRole("button", { name: "Context" })).toBeDisabled()  // nothing to ask about yet
  await box.fill("¶4는?")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [] })
  fake.play(convId!, nuance)  // its rate_limit_event brings the plan's windows
  await expect(thread(page)).toContainText("21s")
  // asked, the fake server answers as the real one does: nothing while no Claude Code runs it
  page.getByRole("button", { name: "Context" }).click()
  await fake.last("context")
  fake.tell({ type: "context", convId, usage: null })
  await expect(page.locator("[data-context]")).toContainText("Known from the next message on")
  await expect(page.locator("[data-context]")).toContainText("Current session")
  await expect(page.locator("[data-context]")).toContainText(/Current week \(all models\)\s*67%/)
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-context]")).toHaveCount(0)

  page.getByRole("button", { name: "Context" }).click()
  await expect.poll(() => fake.said.filter((m) => m.type === "context").length).toBe(2)
  fake.tell({ type: "context", convId, usage: { totalTokens: 574_700, maxTokens: 1_000_000, categories: [
    { name: "Messages", tokens: 571_516, kind: "used" }, { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" }, { name: "Free space", tokens: 392_300, kind: "free" }] } })
  await expect(page.locator("[data-context-total]")).toHaveText("575k / 1000k")
  await expect(page.locator("[data-context]")).toContainText(/Messages\s*57%/)
  await page.getByRole("button", { name: "Compact the conversation" }).click()
  expect(await fake.last("compact")).toEqual({ type: "compact", convId })
})

test("sent while Claude answers, a message waits as Queued until Claude reaches it; a Stop drops what waits (docs/agent.md §33)", async ({ page }) => {
  const fake = await fakeServer(page)
  const box = await openClaude(page)
  await box.fill("¶4의 뉘앙스는?")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [] })
  fake.play(convId!, nuance.slice(0, 60))  // the turn runs
  await expect(page.locator("[data-live-line]")).toBeVisible()

  await expect(box).toBeEnabled()  // the box stays open while Claude answers
  await box.fill("그리고 ¶5는?")
  await box.press("Enter")
  await expect.poll(() => fake.said.filter((m) => m.type === "send").length).toBe(2)
  const queued = thread(page).locator("[data-queued]")
  await expect(queued).toHaveCount(1)
  await expect(queued).toContainText("그리고 ¶5는?")
  await expect(queued).toContainText("Queued")
  await expect(page.locator("[data-live-line]")).not.toContainText("Starting")  // the turn goes on; nothing starts
  fake.tell({ type: "queued", convId, uuid: "u2", text: "그리고 ¶5는?" })
  await expect(queued).toHaveCount(1)  // the server took it: still the one bubble

  fake.tell({ type: "message", convId, message: { type: "user", isReplay: true, uuid: "u2", session_id: "s", message: { role: "user", content: "그리고 ¶5는?" }, parent_tool_use_id: null } })
  await expect(queued).toHaveCount(0)  // delivered: a message like any
  await expect(thread(page).getByText("그리고 ¶5는?")).toBeVisible()

  await box.fill("이건 취소될 말")
  await box.press("Enter")
  await expect.poll(() => fake.said.filter((m) => m.type === "send").length).toBe(3)
  fake.tell({ type: "queued", convId, uuid: "u3", text: "이건 취소될 말" })
  await expect(queued).toHaveCount(1)
  await page.getByRole("button", { name: "Stop" }).click()
  await fake.last("stop")
  fake.tell({ type: "dropped", convId, uuids: ["u3"] })
  await expect(queued).toHaveCount(0)
  await expect(thread(page).getByText("이건 취소될 말")).toHaveCount(0)
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
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  const pair = page.locator("[data-pair]").nth(2)
  const id = Number(await pair.getAttribute("data-pair"))
  const claudeButton = page.getByRole("button", { name: "Claude", exact: true })
  await claudeButton.click()  // the panel closed: Ask Claude opens it
  await expect(claudeButton).toHaveAttribute("aria-pressed", "false")
  await selectWords(pair.locator("p[lang=en]"), "The isthmus had changed")
  await page.locator("[data-floating-toolbar]").getByRole("button", { name: /Ask Claude/ }).click()

  await expect(claudeButton).toHaveAttribute("aria-pressed", "true")
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
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
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

// --- Claude's changes, taken back from the conversation (docs/agent.md §18): the conversation is the recording; the
// change its tool call made is written into the e2e copy under the same tool call id, as the fitz tool would

const writeCall = translate.flatMap((m) => (m.type === "assistant" ? (m.message as { content: { type: string; id?: string; name?: string }[] }).content : []))
  .find((b) => b.type === "tool_use" && b.name?.endsWith("set_translation"))!.id!
async function claudeWrote(page: Page) {
  const { DatabaseSync } = await import("node:sqlite")
  const { execute } = await import("../../server/commands.mjs")
  await page.goto("/")
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  const pair = page.locator("[data-pair]").nth(2)
  const id = Number(await pair.getAttribute("data-pair"))
  const db = new DatabaseSync("/tmp/fitz-e2e.db", { timeout: 5000 })
  try {
    execute(db, "updateSegment", { id, targetDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Claude가 넣은 번역" }] }] }, status: "draft" }, { actor: "agent", toolUseId: writeCall })
  } finally { db.close() }
  return { pair, id }
}
async function playTranslate(page: Page, fake: Awaited<ReturnType<typeof fakeServer>>) {
  const box = page.getByRole("textbox", { name: "Message to Claude" })
  await box.fill("¶3을 번역해서 넣어줘")
  await box.press("Enter")
  const { convId } = await fake.last("start")
  fake.tell({ type: "snapshot", convId, state: foldMessages([]), asks: [] })
  fake.play(convId!, translate)
}

test("Undo from here takes back Claude's changes from that turn; the line stays, struck", async ({ page }) => {
  const fake = await fakeServer(page)
  const { pair } = await claudeWrote(page)
  await page.reload()
  await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
  await page.getByRole("button", { name: "Translate", exact: true }).click()
  await expect(pair.locator("[data-target]")).toHaveText("Claude가 넣은 번역")
  await playTranslate(page, fake)
  const undo = thread(page).getByRole("button", { name: "Undo from here (1)" })
  await expect(undo).toBeVisible()
  await undo.click()
  await expect(pair.locator("[data-target]")).not.toContainText("Claude가 넣은 번역")
  await expect(thread(page).locator("[data-undone]")).toContainText("Wrote the translation of ¶3")
  await expect(thread(page).getByRole("button", { name: /Undo from here/ })).toHaveCount(0)
})

test("Undo from here is refused, and says why, when you changed the same paragraph afterwards", async ({ page, request }) => {
  const fake = await fakeServer(page)
  const { pair, id } = await claudeWrote(page)
  const api = (name: string, data: unknown = {}) => request.post(`http://localhost:4801/api/${name}`, { data })
  expect((await api("updateSegment", { id, patch: { targetDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "내가 그 위에 고친 번역" }] }] } } })).ok()).toBe(true)
  try {
    await page.reload()
    await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
    await page.getByRole("button", { name: "Translate", exact: true }).click()
    await playTranslate(page, fake)
    await thread(page).getByRole("button", { name: "Undo from here (1)" }).click()
    await expect(thread(page).locator("[data-refusal]")).toHaveText(`Not undone: You changed ¶${id} after this. Undo yours first (⌘Z), or keep it.`)
    await expect(pair.locator("[data-target]")).toHaveText("내가 그 위에 고친 번역")
  } finally {
    expect((await api("undo")).ok()).toBe(true)
    expect((await api("undoClaude", { toolUseIds: [writeCall] })).ok()).toBe(true)
  }
})

// --- the checks of a turn's translations (docs/agent.md §19): what the app kept for the recorded turn is shown at its end

function keepChecks(checks: object | null) {
  const init = translate.find((m) => m.type === "system" && m.subtype === "init")!
  const result = translate.find((m) => m.type === "result")! as SdkMessage & { user_message_uuid?: string; uuid: string }
  return import("node:sqlite").then(({ DatabaseSync }) => {
    const db = new DatabaseSync("/tmp/fitz-e2e.db", { timeout: 5000 })
    try {
      if (checks) db.prepare("INSERT OR REPLACE INTO agent_turn(session_id, user_uuid, reason, checks) VALUES (?, ?, 'completed', ?)").run(init.session_id as string, result.user_message_uuid ?? result.uuid, JSON.stringify(checks))
      else db.prepare("DELETE FROM agent_turn WHERE session_id = ?").run(init.session_id as string)
    } finally { db.close() }
  })
}

test("the turn's end shows what the checks found: passed after one fix, or what is left wrong", async ({ page }) => {
  const term = { segmentId: 3, kind: "term", term: "advantages", forms: ["혜택"] }
  try {
    await keepChecks({ checked: [3], rounds: [[term], []] })
    const fake = await fakeServer(page)
    await page.goto("/")
    await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
    await playTranslate(page, fake)
    await expect(thread(page).locator('[data-checks="passed"]')).toHaveText("Checked ¶3 · fixed after 1 try")

    await keepChecks({ checked: [3], rounds: [[term], [term], [term], [term]] })
    await page.reload()
    const again = await fakeServer(page)
    await page.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /18: / }).click()
    await playTranslate(page, again)
    const failed = thread(page).locator('[data-checks="failed"]')
    await expect(failed).toContainText("1 problem left after 3 tries")
    await expect(failed).toContainText("¶3: “advantages” → 혜택 is not in the translation")
  } finally {
    await keepChecks(null)
  }
})
