import assert from "node:assert/strict"
import { test } from "node:test"

import { ago, checksLine, compactLine, doingLine, elapsedText, liveLine, toolLine, tokens, turnLine } from "./trace.ts"

const tool = (name: string, input: Record<string, unknown>, status: "running" | "done" | "error" = "done", result: unknown = null) =>
  ({ kind: "tool" as const, id: "t", name, input, status, result })

test("what Claude read, in a line", () => {
  assert.deepEqual(toolLine(tool("read", { ids: [4], around: 3 })), { title: "Read ¶4 and 3 around" })
  assert.deepEqual(toolLine(tool("read", { ids: [4, 5] })), { title: "Read ¶4, ¶5" })
  assert.deepEqual(toolLine(tool("read", { ids: [1, 2, 3, 4, 5, 6] })), { title: "Read 6 paragraphs" })
  assert.deepEqual(toolLine(tool("read", { chapterId: 1 })), { title: "Read the chapter" })
  assert.deepEqual(toolLine(tool("read", { chapterId: 1, from: 40 })), { title: "Read on in the chapter" })
  assert.deepEqual(toolLine(tool("search", { query: "reserve" })), { title: "Searched “reserve”" })
  assert.deepEqual(toolLine(tool("WebSearch", { query: "위대한 개츠비 첫 문장 번역" })), { title: "Searched the web for “위대한 개츠비 첫 문장 번역”" })
  assert.deepEqual(toolLine(tool("glossary", {})), { title: "Read the glossary" })
})

test("a write: while it goes, once done, and when it did not go through and why", () => {
  assert.deepEqual(toolLine(tool("set_translation", { segmentId: 4 }, "running")), { title: "Writing the translation of ¶4" })
  assert.deepEqual(toolLine(tool("set_translation", { segmentId: 4 })), { title: "Wrote the translation of ¶4" })
  assert.deepEqual(toolLine(tool("set_translation", { segmentId: 4 }, "error", "The translator declined this. Do not try it another way.")),
    { title: "Did not write the translation of ¶4", note: "you declined" })
  assert.deepEqual(toolLine(tool("add_comment", { segmentId: 4 })), { title: "Commented on ¶4" })
  assert.equal(toolLine(tool("StructuredOutput", { suggestions: [] })), null, "a task's answer is not a line")
})

test("the block being written, and a turn's end", () => {
  assert.equal(doingLine("read"), "Reading")
  assert.equal(doingLine("WebSearch"), "Searching the web")
  assert.equal(doingLine(undefined), "Working")
  assert.deepEqual(turnLine({ kind: "turn", reason: "completed", isError: false, ms: 6800, cost: 0.0312 }), { text: "7s", stopped: false }, "the time, not the cost")
  assert.deepEqual(turnLine({ kind: "turn", reason: "completed", isError: false, ms: 300, cost: 0.25 }), { text: "1s", stopped: false })
  assert.deepEqual(turnLine({ kind: "turn", reason: "aborted_streaming", isError: true, ms: 4000, cost: 0.01 }), { text: "Stopped", stopped: true })
  assert.deepEqual(turnLine({ kind: "turn", reason: "error_max_turns", isError: true, ms: 4000, cost: 0.01 }), { text: "Claude stopped: error_max_turns", stopped: true })
})

test("why Claude stopped, said so the translator knows what to do next (docs/agent.md §29)", () => {
  const ended = (error: string, limits: { resetsAt: number } | null = null) =>
    turnLine({ kind: "turn", reason: "api_error", isError: true, ms: 500, cost: 0, error }, limits).text
  assert.equal(ended("authentication_failed"), "Not logged in — run `claude /login` in a terminal")
  assert.equal(ended("rate_limit", { resetsAt: Date.parse("2026-10-25T08:50:00Z") }), `Usage limit reached — resets at ${new Date("2026-10-25T08:50:00Z").toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`)
  assert.equal(ended("rate_limit"), "Usage limit reached")
  assert.equal(ended("overloaded"), "Claude is overloaded — try again in a moment")
  assert.equal(ended("billing_error"), "A billing problem on the account")
  assert.equal(ended("server_error"), "Claude stopped: server_error")
  assert.equal(turnLine({ kind: "turn", reason: "completed", isError: false, ms: 6800, cost: 0.03, error: null }).text, "7s")
})

test("while Claude Code retries, the live line says so", () => {
  const at = (o: Partial<Parameters<typeof liveLine>[0]>) => liveLine({ sent: false, live: null, began: false, waiting: false, retry: null, ...o })
  assert.equal(at({ retry: { attempt: 2, max: 10, delayMs: 8000, error: "overloaded" } }), "Retrying 2/10 · overloaded · 8s")
  assert.equal(at({ retry: { attempt: 1, max: 10, delayMs: 500, error: "server_error" }, live: { kind: "thinking" } }), "Retrying 1/10 · server_error · 1s", "outranks the block that was streaming")
  assert.equal(at({ waiting: true, retry: { attempt: 1, max: 10, delayMs: 500, error: "x" } }), "Waiting for your answer")
})

test("a compaction's line, and the live line while it goes (docs/agent.md §32)", () => {
  assert.equal(compactLine({ pre: 5028, post: 1087 }), "Compacted 5.0k → 1.1k")
  assert.equal(compactLine({ pre: 571_516, post: 120_400 }), "Compacted 572k → 120k")
  assert.equal(compactLine({ pre: null, post: null }), "Compacted")
  assert.deepEqual([tokens(999), tokens(4769)], ["999", "4.8k"])
  assert.equal(liveLine({ sent: false, live: null, began: true, waiting: false, compacting: true }), "Compacting")
})

test("how long ago", () => {
  const now = Date.parse("2026-10-18T12:00:00Z")
  assert.equal(ago("2026-10-18 11:59:30", now), "now")
  assert.equal(ago("2026-10-18 11:55:00", now), "5m")
  assert.equal(ago("2026-10-18 09:00:00", now), "3h")
  assert.equal(ago("2026-10-15 12:00:00", now), "3d")
})

test("a turn's checks in a line: passed, fixed after being sent back, left wrong, or not checked", () => {
  const term = { segmentId: 3, kind: "term" as const, term: "advantages", forms: ["혜택", "좋은 조건"] }
  assert.deepEqual(checksLine({ checked: [3, 4], rounds: [[]] }), { ok: true, text: "Checked ¶3, ¶4", details: [] })
  assert.deepEqual(checksLine({ checked: [3], rounds: [[term], []] }), { ok: true, text: "Checked ¶3 · fixed after 1 try", details: [] })
  assert.deepEqual(checksLine({ checked: [3, 4], rounds: [[term], [term], [term], [term, { segmentId: 4, kind: "note", quote: "유보하는" }]] }), {
    ok: false, text: "2 problems left after 3 tries",
    details: ["¶3: “advantages” → 혜택 / 좋은 조건 is not in the translation", "¶4: the note at “유보하는” lost its place"],
  })
  assert.deepEqual(checksLine({ checked: [3], rounds: [], error: "could not check: no such table" }), { ok: null, text: "Not checked", details: ["could not check: no such table"] })
})

test("the live line names what Claude is doing now, from Enter on; nothing while its words stream (docs/agent.md §26)", () => {
  const at = (o: Partial<Parameters<typeof liveLine>[0]>) => liveLine({ sent: false, live: null, began: false, waiting: false, ...o })
  assert.equal(at({ sent: true }), "Starting", "sent, not yet echoed")
  assert.equal(at({}), "Thinking", "echoed, nothing streaming yet")
  assert.equal(at({ live: { kind: "thinking" } }), "Thinking")
  assert.equal(at({ live: { kind: "tool", name: "read" } }), "Reading")
  assert.equal(at({ began: true }), "Working", "between blocks")
  assert.equal(at({ live: { kind: "text" } }), null, "its words show it")
  assert.equal(at({ waiting: true, began: true }), "Waiting for your answer")
})

test("the time on the live line: tenths of a second, then minutes", () => {
  assert.equal(elapsedText(0), "0.0s")
  assert.equal(elapsedText(3_499), "3.4s")
  assert.equal(elapsedText(59_990), "59.9s", "never 60.0s")
  assert.equal(elapsedText(61_250), "1m 1.2s")
  assert.equal(elapsedText(-40), "0.0s", "a clock a little behind the server's")
})
