import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { findOnce } from "../commands.mjs"
import { saveSuggestions, watchSuggestions } from "./suggestions.mjs"

const CONV = "0b6f3f2e-6a3c-4d0e-9d55-6a1c2f0e9b11"

function gatsby() {
  const db = new DatabaseSync(":memory:")
  db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  db.exec(readFileSync(new URL("./fixtures/gatsby.sql", import.meta.url), "utf8"))
  return db
}
const versionOf = (db, id) => db.prepare("SELECT version FROM segment WHERE id = ?").get(id).version
const review = (db, ...suggestions) => saveSuggestions(db, { conversationId: CONV, task: "review", answer: { suggestions } })
const typos = (db, ...suggestions) => saveSuggestions(db, { conversationId: CONV, task: "typos", answer: { suggestions } })
const rows = (db) => db.prepare("SELECT segment_id, side, quote, status FROM agent_suggestion ORDER BY id").all().map((r) => ({ ...r }))

test("findOnce: where the quote is, only when it is there exactly once", () => {
  assert.equal(findOnce("in a reserved way", "reserved"), 5)
  assert.equal(findOnce("reserved; reserve all", "reserve"), -1)
  assert.equal(findOnce("aaa", "aa"), -1)
  assert.equal(findOnce("abc", "x"), -1)
  assert.equal(findOnce("abc", ""), -1)
})

test("a review suggestion is kept on the translation, with the paragraph's version then", () => {
  const db = gatsby()
  const s = { segmentId: 2, quote: "쉽게 상처받던", replacement: "여리던", why: "vulnerable의 결", level: "medium" }
  const { saved, skipped } = review(db, s)
  assert.deepEqual(skipped, [])
  const { id, createdAt, ...row } = saved[0]
  assert.ok(id && createdAt)
  assert.deepEqual(row, { conversationId: CONV, task: "review", segmentId: 2, side: "target", quote: s.quote, replacement: s.replacement, why: s.why, level: "medium", baseVersion: versionOf(db, 2), status: "open" })
})

test("an OCR suggestion is kept on the source, without a level", () => {
  const db = gatsby()
  const { saved } = typos(db, { segmentId: 4, quote: "in a reserved way", replacement: "in a reserved manner", why: "예시" })
  assert.deepEqual([saved[0].side, saved[0].level, saved[0].task], ["source", null, "typos"])
})

test("one that does not point at one place, or changes nothing, is not kept, and says why", () => {
  const db = gatsby()
  const { saved, skipped } = typos(db,
    { segmentId: 99, quote: "x", replacement: "y", why: "-" },
    { segmentId: 4, quote: "reserves", replacement: "x", why: "-" },
    { segmentId: 4, quote: "reserve", replacement: "x", why: "-" },
    { segmentId: 5, quote: "abnormal", replacement: "abnormal", why: "-" },
  )
  assert.deepEqual(saved, [])
  assert.deepEqual(skipped.map((s) => s.why), [
    "there is no ¶99",
    "the quote is not in ¶4's source",
    "the quote appears more than once in ¶4's source",
    "the replacement changes nothing",
  ])
  assert.deepEqual(review(db, { segmentId: 3, quote: "Whenever", replacement: "x", why: "-", level: "low" }).skipped.map((s) => s.why),
    ["the quote is not in ¶3's translation"], "a paragraph with no translation has nothing to review")
  assert.deepEqual(rows(db), [])
})

test("one that overlaps an open suggestion is not kept — from the same answer or a second run; a decided one does not count", () => {
  const db = gatsby()
  const first = { segmentId: 2, quote: "쉽게 상처받던", replacement: "여리던", why: "-", level: "low" }
  const { saved, skipped } = review(db, first, { ...first, quote: "상처받던 시절", replacement: "x" }, { ...first, quote: "곱씹어 왔다", replacement: "되새겨 왔다" })
  assert.deepEqual(saved.map((s) => s.quote), ["쉽게 상처받던", "곱씹어 왔다"])
  assert.deepEqual(skipped.map((s) => s.why), ["it overlaps an open suggestion"])
  assert.deepEqual(review(db, first).skipped.map((s) => s.why), ["it overlaps an open suggestion"], "a second run does not repeat it")
  assert.equal(typos(db, { segmentId: 2, quote: "In my younger", replacement: "x", why: "-" }).saved.length, 1, "the other side is other words")
  db.prepare("UPDATE agent_suggestion SET status = 'dismissed' WHERE quote = ?").run(first.quote)
  assert.equal(review(db, first).saved.length, 1)
})

test("an answer of another shape is refused whole, and nothing is kept", () => {
  const db = gatsby()
  const ok = { segmentId: 2, quote: "쉽게 상처받던", replacement: "여리던", why: "-", level: "low" }
  assert.throws(() => review(db, ok, { ...ok, level: "urgent" }), /agreed shape/)
  assert.deepEqual(rows(db), [])
})

test("new suggestions are announced once they are kept, by paragraph; an answer that keeps none says nothing", () => {
  const db = gatsby()
  const heard = []
  const stop = watchSuggestions(db, (c) => heard.push({ ...c, kept: rows(db).length }))
  review(db, { segmentId: 2, quote: "쉽게 상처받던", replacement: "여리던", why: "-", level: "low" }, { segmentId: 2, quote: "곱씹어 왔다", replacement: "x", why: "-", level: "low" })
  review(db, { segmentId: 99, quote: "x", replacement: "y", why: "-", level: "low" })
  stop()
  review(db, { segmentId: 2, quote: "그 말을", replacement: "그것을", why: "-", level: "low" })
  assert.deepEqual(heard, [{ segmentIds: [2], kept: 2 }])
})
