import assert from "node:assert/strict"
import { test } from "node:test"

import { ago, checksLine, doingLine, toolLine, turnLine } from "./trace.ts"

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
  assert.deepEqual(turnLine({ kind: "turn", reason: "completed", isError: false, ms: 6800, cost: 0.0312 }), { text: "7s · $0.031", stopped: false })
  assert.deepEqual(turnLine({ kind: "turn", reason: "completed", isError: false, ms: 300, cost: 0.25 }), { text: "1s · $0.25", stopped: false })
  assert.deepEqual(turnLine({ kind: "turn", reason: "aborted_streaming", isError: true, ms: 4000, cost: 0.01 }), { text: "Stopped", stopped: true })
  assert.deepEqual(turnLine({ kind: "turn", reason: "error_max_turns", isError: true, ms: 4000, cost: 0.01 }), { text: "Claude stopped: error_max_turns", stopped: true })
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
