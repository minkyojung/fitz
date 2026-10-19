import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { execute, undo } from "../commands.mjs"
import { changedParagraphs, drillInput, saveCards, shuffled, writtenBy } from "./cards.mjs"

const AGENT = { actor: "agent", toolUseId: "toolu_01" }
const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
const KO3 = "“누군가를 비판하고 싶어질 때면,” 아버지는 말씀하셨다. “세상 사람들이 다 너처럼 좋은 조건을 누린 건 아니란다.”"
const KO4 = "아버지는 더 말이 없었지만, 우리는 말을 아끼면서도 잘 통했다. 그래서 나는 판단을 유보하는 버릇이 생겼다."

/** Gatsby's chapter I (¶2 translated when built, without a logged change), then a day's work: the translator
 *  translates ¶3, Claude ¶4, the translator fixes a word of ¶5's source, and translates ¶5 then takes it back. */
function gatsbyDay() {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  db.exec(readFileSync(new URL("../agent/fixtures/gatsby.sql", import.meta.url), "utf8"))
  execute(db, "updateSegment", { id: 3, targetDoc: doc(KO3) })
  execute(db, "updateSegment", { id: 4, targetDoc: doc(KO4) }, AGENT)
  execute(db, "updateSegment", { id: 5, text: db.prepare("SELECT source_text FROM segment WHERE id = 5").get().source_text.replace("wild, unknown men", "wild unknown men") })
  execute(db, "updateSegment", { id: 5, targetDoc: doc("곧 지울 번역") })
  undo(db)
  return db
}
const run = (db) => Number(db.prepare("INSERT INTO drill_run(slot, status) VALUES ('2026-10-19', 'running')").run().lastInsertRowid)
/** Everything logged so far happened yesterday morning; the last run began at noon. */
const yesterday = (db) => { db.prepare("UPDATE ops SET created_at = '2000-01-01 09:00:00'").run(); return "2000-01-01 12:00:00" }
const cards = (db) => db.prepare("SELECT segment_id, kind, origin, written_by, quote, options, answer, proposal, box, due_on, made_on, status FROM drill_card ORDER BY id").all().map((r) => ({ ...r }))
const meaning = (over = {}) => ({ segmentId: 4, kind: "meaning", quote: "veteran bores", question: "veteran bores는?", options: ["이골이 난 따분한 사람들", "노련한 퇴역 군인들", "오래 일한 시추공들", "산전수전 겪은 사냥꾼들"], answer: 0, why: "bore는 지루한 사람", ...over })
const challenge = (over = {}) => ({ segmentId: 4, quote: "말을 아끼면서도 잘 통했다", proposal: "말을 아끼면서도 유난히 잘 통했다", question: "unusually가 빠졌습니다. 그대로 두시겠어요?", why: "unusually communicative", ...over })
const answer = (c = [], ch = []) => ({ cards: c, challenges: ch })
/** A fixed sequence for Math.random's place: the shuffle under test is the same every run. */
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length] }

test("the day's material: paragraphs whose translation a standing change wrote, the translator's and Claude's, in book order", () => {
  const db = gatsbyDay()
  // ¶5's source edit is not a translation, its translation was taken back, ¶2 was translated before any logged change
  assert.deepEqual(changedParagraphs(db), [3, 4])
  assert.equal(writtenBy(db, 3), "translator")
  assert.equal(writtenBy(db, 4), "agent")
  assert.equal(writtenBy(db, 2), "translator")  // nothing logged: the translator's
  execute(db, "updateSegment", { id: 4, targetDoc: doc(KO4.replace("잘 통했다", "유난히 잘 통했다")) })
  assert.equal(writtenBy(db, 4), "translator")
})

test("a run reads only what changed since the last one began", () => {
  const db = gatsbyDay()
  const since = yesterday(db)
  execute(db, "updateSegment", { id: 2, targetDoc: doc("어리고 여리던 시절, 아버지가 해 주신 충고를 나는 지금까지 곱씹어 왔다.") })
  assert.deepEqual(changedParagraphs(db), [2, 3, 4])
  assert.deepEqual(changedParagraphs(db, { since }), [2])
  // a status change is not a translation written
  db.prepare("UPDATE ops SET created_at = '2000-01-01 09:00:00'").run()
  execute(db, "updateSegment", { id: 3, status: "reviewed" })
  assert.deepEqual(changedParagraphs(db, { since }), [])
  // "more from the last 7 days" reaches back by time from now
  assert.deepEqual(changedParagraphs(db, { days: 7 }), [])
  db.prepare("UPDATE ops SET created_at = datetime('now', '-6 days') WHERE id <= 2").run()
  assert.deepEqual(changedParagraphs(db, { days: 7 }), [3, 4])
})

test("a translation written after an undo is material, though its change takes the undone one's id", () => {
  const db = gatsbyDay()
  execute(db, "updateSegment", { id: 5, targetDoc: doc("비정상적인 사람일수록 이런 기질을 금세 알아본다.") })
  const top = db.prepare("SELECT max(id) AS id FROM ops").get().id
  const since = yesterday(db)
  undo(db)
  execute(db, "updateSegment", { id: 3, targetDoc: doc(KO3.replace("아니란다", "아니라는 걸 기억하렴")) })
  assert.equal(db.prepare("SELECT max(id) AS id FROM ops").get().id, top)  // the same id again
  assert.deepEqual(changedParagraphs(db, { since }), [3])
})

test("what a run gives Claude: the changed paragraphs and those words were picked from, what is known, what has cards", () => {
  const db = gatsbyDay()
  db.prepare("INSERT INTO drill_pick(segment_id, quote, origin) VALUES (5, 'privy to', 'picked'), (2, 'turning over', 'asked')").run()
  const input = drillInput(db, {})
  assert.deepEqual(input.ids, [2, 3, 4, 5])
  assert.deepEqual(input.picks.map((p) => [p.segmentId, p.quote, p.origin]), [[5, "privy to", "picked"], [2, "turning over", "asked"]])
  assert.deepEqual(input.known, [])
  saveCards(db, { runId: run(db), answer: answer([meaning(), meaning({ segmentId: 2, quote: "turning over in my mind" })]), input, today: "2026-10-19" })
  db.prepare("UPDATE drill_card SET status = 'known' WHERE quote = 'turning over in my mind'").run()
  const next = drillInput(db, { since: yesterday(db) })
  assert.deepEqual(next.ids, [])  // nothing changed since, and the picks were spent
  assert.deepEqual(drillInput(db, {}).existing, ["veteran bores"])
  assert.deepEqual(drillInput(db, {}).known, ["turning over in my mind"])
})

test("options are shuffled and the answer follows its option; over many shuffles every place is used alike", () => {
  const opts = ["a", "b", "c", "d"]
  const s = shuffled(opts, 0, seq(0.9, 0.1, 0.5))
  assert.equal(s.options[s.answer], "a")
  assert.deepEqual([...s.options].sort(), opts)
  let x = 7
  const lcg = () => (x = (x * 48271) % 2147483647) / 2147483647
  const places = [0, 0, 0, 0]
  for (let i = 0; i < 4000; i++) places[shuffled(opts, 0, lcg).answer]++
  assert.ok(places.every((n) => n > 900 && n < 1100), `places ${places}`)
})

test("cards that hold are kept, as of today, in box 1, with who wrote the paragraph's translation", () => {
  const db = gatsbyDay()
  const input = drillInput(db, {})
  const r = saveCards(db, { runId: run(db), answer: answer([meaning(), meaning({ segmentId: 3, kind: "nuance", quote: "the advantages", answer: 2 })], [challenge()]), input, today: "2026-10-19", random: seq(0.1, 0.7, 0.3) })
  assert.deepEqual(r, { made: 3, dropped: [] })
  const kept = cards(db)
  assert.deepEqual(kept.map((c) => [c.segment_id, c.kind, c.written_by, c.origin, c.box, c.due_on, c.made_on, c.status]), [
    [4, "meaning", "agent", "claude", 1, "2026-10-19", "2026-10-19", "active"],
    [3, "nuance", "translator", "claude", 1, "2026-10-19", "2026-10-19", "active"],
    [4, "challenge", "agent", "claude", 1, "2026-10-19", "2026-10-19", "active"],
  ])
  // the right option is still the right one, wherever it went
  assert.equal(JSON.parse(kept[0].options)[kept[0].answer], "이골이 난 따분한 사람들")
  assert.equal(kept[2].options, null)
  assert.equal(kept[2].proposal, "말을 아끼면서도 유난히 잘 통했다")
})

test("what does not hold is dropped, each with why", () => {
  const db = gatsbyDay()
  db.prepare("INSERT INTO drill_pick(segment_id, quote, origin) VALUES (5, 'privy to', 'picked')").run()  // ¶5 is given, untranslated
  const input = drillInput(db, {})
  db.prepare("INSERT INTO drill_run(slot, status) VALUES (NULL, 'done')").run()
  db.prepare(`INSERT INTO drill_card(run_id, segment_id, kind, origin, written_by, quote, question, options, answer, why, base_version, due_on, made_on, status)
              VALUES (1, 4, 'meaning', 'claude', 'agent', 'Curious  Natures', '?', '["a","b","c","d"]', 0, 'w', 1, '2026-10-01', '2026-10-01', 'known')`).run()
  const r = saveCards(db, {
    runId: run(db), input, today: "2026-10-19",
    answer: answer([
      meaning({ segmentId: 2 }),                                   // ¶2 was not given
      meaning({ quote: "veteran boars" }),                          // not in the source
      meaning({ quote: "a" }),                                      // not exactly once
      meaning({ options: ["같다", "같다 ", "다르다", "또 다르다"] }), // two options the same
      meaning({ quote: "curious natures" }),                        // known, however it was written
      meaning(),
      meaning({ quote: "veteran bores" }),                          // twice in one answer
      meaning({ quote: "reserve all judgments" }),
      meaning({ quote: "unusually communicative" }),
      meaning({ quote: "a great deal more" }),                      // a fourth on ¶4
    ], [
      challenge({ segmentId: 5, quote: "곧", proposal: "이제" }),   // ¶5 has no translation (taken back)
      challenge({ quote: "유난히" }),                               // not in the translation
      challenge({ proposal: " 말을 아끼면서도 잘 통했다 " }),        // changes nothing
    ]),
  })
  assert.equal(r.made, 3)
  assert.deepEqual(r.dropped.map((d) => d.why), [
    "not one of the paragraphs given", "the quote is not in the source exactly once", "the quote is not in the source exactly once",
    "the options are not four different ones", "the translator knows it or has a card on it", "the translator knows it or has a card on it",
    "too many cards on one paragraph", "the paragraph has no translation", "the quote is not in the translation exactly once", "the proposal changes nothing",
  ])
})

test("a card on a word the translator picked or asked about is theirs, matched however much Claude quoted; picks are spent", () => {
  const db = gatsbyDay()
  db.prepare("INSERT INTO drill_pick(segment_id, quote, origin) VALUES (4, 'bores', 'picked'), (4, 'reserve all judgments', 'asked'), (4, 'communicative', 'picked')").run()
  const input = drillInput(db, {})
  const runId = run(db)
  saveCards(db, { runId, input, today: "2026-10-19", answer: answer([meaning(), meaning({ quote: "reserve all judgments" })]) })
  assert.deepEqual(cards(db).map((c) => [c.quote, c.origin]), [["veteran bores", "picked"], ["reserve all judgments", "asked"]])
  assert.deepEqual(db.prepare("SELECT run_id FROM drill_pick ORDER BY id").all().map((r) => r.run_id), [runId, runId, runId])
})

test("an answer not of the task's shape is refused whole", () => {
  const db = gatsbyDay()
  const input = drillInput(db, {})
  assert.throws(() => saveCards(db, { runId: run(db), input, today: "2026-10-19", answer: { cards: [meaning({ options: ["하나", "둘", "셋"] })], challenges: [] } }), /agreed shape: cards\.0\.options/)
  assert.throws(() => saveCards(db, { runId: run(db), input, today: "2026-10-19", answer: { cards: [] } }), /agreed shape/)
  assert.deepEqual(cards(db), [])
})
