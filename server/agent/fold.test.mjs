import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { applyMessage, emptyConversation, foldMessages } from "./fold.mjs"

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
  assert.deepEqual(turn, { kind: "turn", reason: "completed", isError: false, ms: result.duration_ms, cost: result.total_cost_usd })
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
