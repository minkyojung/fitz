import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { applyMessage, emptyConversation, foldMessages, foldStored } from "./fold.mjs"

// A real turn recorded with record.mjs against fixtures/gatsby.sql (Opus 5.5, Claude Code 2.1.302):
// the translator asks about a phrase in ¶4; Claude reads ¶4 with three paragraphs around it, thinks, answers.
const recording = (name) => readFileSync(new URL(`./fixtures/${name}.jsonl`, import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l))
const nuance = recording("nuance")
const PROMPT = "¶4의 'unusually communicative in a reserved way'는 어떤 뉘앙스야? 어떻게 옮기면 좋을까?"

const deepFreeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(deepFreeze) }
  return v
}

test("a recorded turn folds to: the question, one read, thinking, the answer, the turn's end", () => {
  const s = foldMessages(nuance)
  assert.deepEqual(s.items.map((i) => i.kind), ["user", "tool", "thinking", "text", "turn"])
  const [user, tool, thinking, text, turn] = s.items
  assert.equal(user.text, PROMPT)
  assert.match(user.uuid, /^[0-9a-f-]{36}$/)
  assert.equal(tool.name, "read")
  assert.deepEqual(tool.input, { ids: [4], around: 3 })
  assert.equal(tool.status, "done")
  assert.deepEqual(tool.result.segments.map((x) => x.id), [1, 2, 3, 4, 5])
  assert.ok(thinking.text.length > 0)
  assert.equal(text.text, nuance.find((m) => m.type === "result").result)
  const result = nuance.find((m) => m.type === "result")
  assert.deepEqual(turn, { kind: "turn", reason: "completed", isError: false, ms: result.duration_ms, cost: result.total_cost_usd, error: null })
  assert.equal(s.status, "idle")
  assert.equal(s.live, null)
  assert.equal(s.sessionId, nuance.find((m) => m.subtype === "init").session_id)
  assert.equal(s.model, "claude-opus-5-5")
})

test("while the answer streams, live holds exactly what has been written so far", () => {
  const final = foldMessages(nuance).items.find((i) => i.kind === "text").text
  const answerAt = nuance.findLastIndex((m) => m.type === "assistant")
  let state = emptyConversation()
  let seen = 0
  for (const m of nuance.slice(0, answerAt)) {
    state = applyMessage(state, m)
    if (state.live?.kind === "text") { assert.ok(final.startsWith(state.live.text)); seen++ }
  }
  assert.ok(seen > 10, `streamed in ${seen} steps`)
  assert.equal(state.live.text, final)
  assert.equal(state.items.some((i) => i.kind === "text"), false)
  state = applyMessage(state, nuance[answerAt])
  assert.equal(state.live, null)
  assert.equal(state.items.at(-1).text, final)
})

test("the tool shows as running from its call until its result", () => {
  const callAt = nuance.findIndex((m) => m.type === "assistant")
  const s = foldMessages(nuance.slice(0, callAt + 1))
  assert.deepEqual(s.items.at(-1), { kind: "tool", id: nuance[callAt].message.content[0].id, name: "read", input: { ids: [4], around: 3 }, status: "running", result: null })
})

test("folding never mutates the state it is given", () => {
  let state = deepFreeze(emptyConversation())
  for (const m of nuance) state = deepFreeze(applyMessage(state, m))
  assert.deepEqual(state, foldMessages(nuance))
})

test("a window that joins mid-turn from a snapshot ends where the server is", () => {
  const all = foldMessages(nuance)
  for (const cut of [0, 7, 100, 300, nuance.length - 2]) {
    const snapshot = JSON.parse(JSON.stringify(foldMessages(nuance.slice(0, cut))))  // as sent over the socket
    assert.deepEqual(foldMessages(nuance.slice(cut), snapshot), all, `cut at ${cut}`)
  }
})

test("messages it does not know leave the state as it was", () => {
  const s = foldMessages(nuance)
  for (const m of [{ type: "rate_limit_event" }, { type: "command_lifecycle", state: "completed" }, { type: "system", subtype: "thinking_tokens" }, { type: "something_new" }])
    assert.equal(applyMessage(s, m), s)
})

test("a failed tool call is an error with the text the model read", () => {
  const call = { type: "assistant", parent_tool_use_id: null, uuid: "a1", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "mcp__fitz__read", input: { ids: [99] } }] } }
  const failed = { type: "user", parent_tool_use_id: null, tool_use_result: "Error: segment 99 not found",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "segment 99 not found" }] }] } }
  const [tool] = foldMessages([call, failed]).items
  assert.deepEqual({ status: tool.status, result: tool.result }, { status: "error", result: "segment 99 not found" })
})

test("each turn's cost is what it added to the process's running total", () => {
  const result = (total) => ({ type: "result", subtype: "success", terminal_reason: "completed", is_error: false, duration_ms: 1, total_cost_usd: total })
  const turns = foldMessages([result(0.3), result(0.5)]).items
  assert.deepEqual(turns.map((t) => Math.round(t.cost * 10) / 10), [0.3, 0.2])
})

// A real turn with a write: "¶3을 번역해서 번역문에 넣어줘", recorded through host.mjs with the write allowed.
const translate = recording("translate")

test("a recorded write: the call, the wait for the translator, and the draft it wrote", () => {
  const s = foldMessages(translate)
  const write = s.items.find((i) => i.kind === "tool" && i.name === "set_translation")
  assert.equal(write.status, "done")
  assert.equal(write.input.segmentId, 3)
  assert.deepEqual([write.result.segmentId, write.result.status], [3, "draft"])
  assert.equal(write.result.targetText, write.input.text)
  assert.equal(s.items.at(-1).kind, "turn")
  // while the translator was being asked, Claude Code said the session was waiting
  const statuses = []
  translate.reduce((state, m) => { const next = applyMessage(state, m); if (next.status !== state.status) statuses.push(next.status); return next }, emptyConversation())
  assert.ok(statuses.includes("requires_action"), statuses.join(" → "))
  assert.equal(s.status, "idle")
})

// A real turn with web searches (Opus 5.5, Claude Code 2.1.302): "¶2는 『위대한 개츠비』의 유명한 첫 문장이야. 국내에
// 나온 번역본들이 이 문장을 어떻게 옮겼는지 웹에서 찾아서 두세 가지만 알려줘." Claude read ¶2 and searched three times.
const websearch = recording("websearch")

test("a recorded web search: each search is a tool call with its query, done, holding the results the model read", () => {
  const s = foldMessages(websearch)
  const searches = s.items.filter((i) => i.kind === "tool" && i.name === "WebSearch")
  assert.equal(searches.length, 3)
  for (const w of searches) {
    assert.equal(w.status, "done")
    assert.ok(w.result.startsWith(`Web search results for query: "${w.input.query}"`), w.result.slice(0, 120))
  }
  assert.equal(s.items.at(-1).kind, "turn")
})

// --- read back from disk: getSessionMessages (recorded beside each recording as *.stored.json) and the kept turn
// make the same conversation the live fold made (docs/agent.md §13). A test to keep.

const stored = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.stored.json`, import.meta.url), "utf8"))
const keptTurn = (frames) => {
  const live = foldMessages(frames)
  const { kind: _, ...turn } = live.items.at(-1)
  return new Map([[frames.find((m) => m.type === "result").user_message_uuid, turn]])
}
const shape = (state) => state.items.map(({ id: _, ...item }) => item)

// the review and the OCR-error hunt (Sonnet 5.5, fixtures/gatsby-tasks.sql): the answer is a StructuredOutput tool call
for (const [name, frames] of [["nuance", nuance], ["translate", translate], ["websearch", websearch], ["review", recording("review")], ["typos", recording("typos")]]) {
  test(`${name}: the conversation read back from disk is the conversation seen live`, () => {
    const live = foldMessages(frames)
    const back = foldStored(stored(name), keptTurn(frames), live.sessionId)
    assert.deepEqual(shape(back), shape(live))
    assert.deepEqual([back.sessionId, back.status, back.live], [live.sessionId, "idle", null])
  })
}

test("read back without a kept turn, the conversation is all there but its turn's end is not invented", () => {
  const back = foldStored(stored("nuance"))
  assert.deepEqual(back.items.map((i) => i.kind), ["user", "tool", "thinking", "text"])
})

test("what Claude Code writes when a turn is stopped is not shown as the translator's words", () => {
  const msgs = [
    { type: "user", uuid: "u1", message: { role: "user", content: "¶4는?" } },
    { type: "user", uuid: "u2", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
    { type: "user", uuid: "u3", message: { role: "user", content: "다시" } },
  ]
  assert.deepEqual(foldStored(msgs).items.map((i) => i.text), ["¶4는?", "다시"])
})

// --- why Claude stopped (docs/agent.md §29)

const nologin = recording("nologin")
const RETRY = { type: "system", subtype: "api_retry", attempt: 2, max_retries: 10, retry_delay_ms: 8000, error_status: 529, error: "overloaded", uuid: "r", session_id: "s" }

test("a recorded turn with no login: the turn's end carries the error Claude Code named", () => {
  const s = foldMessages(nologin)
  const turn = s.items.at(-1)
  assert.deepEqual([turn.kind, turn.reason, turn.isError, turn.error], ["turn", "api_error", true, "authentication_failed"])
  assert.equal(foldMessages(nuance).items.at(-1).error, null, "a turn that went well names none")
})

test("a retry is held while it lasts, and gone with the next thing Claude Code says", () => {
  const during = applyMessage(foldMessages(nuance.slice(0, 6)), RETRY)
  assert.deepEqual(during.retry, { attempt: 2, max: 10, delayMs: 8000, error: "overloaded" })
  assert.equal(applyMessage(during, nuance[6]).retry, null, "the next stream event")
  assert.equal(applyMessage(during, nuance.find((m) => m.type === "result")).retry, null, "or the result")
  assert.equal(emptyConversation().retry, null)
})

test("the last rate_limit_event is kept: the plan's windows, for the usage the page shows", () => {
  const s = foldMessages(nuance)
  const event = nuance.find((m) => m.type === "rate_limit_event").rate_limit_info
  assert.deepEqual(s.limits, { status: "allowed", type: "five_hour", resetsAt: event.resetsAt * 1000, windows: event.unifiedWindows })
  assert.equal(emptyConversation().limits, null)
})

// --- a compacted conversation (docs/agent.md §32): recorded with record.mjs --then, Haiku

const compact = recording("compact")
const storedCompact = JSON.parse(readFileSync(new URL("./fixtures/compact.stored.json", import.meta.url), "utf8"))

test("compacted mid-way, the conversation shows the two questions, a Compacted line with the counts, and two turns — not the summary, nor the command", () => {
  const s = foldMessages(compact)
  assert.deepEqual(s.items.filter((i) => i.kind === "user").map((i) => i.text), ["¶4를 읽고 한 줄로 요약해.", "방금 요약한 문단 번호만 말해."])
  const boundary = compact.find((m) => m.subtype === "compact_boundary").compact_metadata
  assert.deepEqual(s.items.filter((i) => i.kind === "compact"), [{ kind: "compact", pre: boundary.pre_tokens, post: boundary.post_tokens }])
  assert.equal(s.items.filter((i) => i.kind === "turn").length, 2, "the compaction is not a turn")
  const spent = compact.filter((m) => m.type === "result").at(-1).total_cost_usd
  assert.equal(s.spent, spent, "but what it cost is counted")
  assert.equal(s.compacting, false)
})

test("while Claude Code compacts, the state says so", () => {
  const at = compact.findIndex((m) => m.type === "system" && m.subtype === "status" && m.status === "compacting")
  assert.equal(foldMessages(compact.slice(0, at + 1)).compacting, true)
  assert.equal(foldMessages(compact.slice(0, at + 2)).compacting, false, "the next status ends it")
})

test("read back from disk, the summary and the command are not the translator's words either", () => {
  const s = foldStored(storedCompact)
  assert.deepEqual(s.items.filter((i) => i.kind === "user").map((i) => i.text), ["방금 요약한 문단 번호만 말해."])
  assert.ok(s.items.every((i) => i.kind !== "text" || !/^<(command-name|local-command-stdout)>/.test(i.text)))
})
