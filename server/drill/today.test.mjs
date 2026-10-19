import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { execute, redo, undo } from "../commands.mjs"
import { watchSession } from "./cards.mjs"
import { addDays } from "./schedule.mjs"
import { answerCard, closeChallenge, DAILY, moreToday, pickWords, sentenceAround, sessionToday, setCardAside } from "./today.mjs"

const TODAY = "2026-10-19"
const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
const KO4 = "아버지는 더 말이 없었지만, 우리는 말을 아끼면서도 잘 통했다. 그래서 나는 판단을 유보하는 버릇이 생겼다."

function gatsby() {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"))
  db.exec(readFileSync(new URL("../agent/fixtures/gatsby.sql", import.meta.url), "utf8"))
  execute(db, "updateSegment", { id: 4, targetDoc: doc(KO4) })
  db.prepare("INSERT INTO drill_run(id, slot, status) VALUES (1, ?, 'done')").run(TODAY)
  return db
}
/** A card as a run keeps it: right option at `answer`, asked from `due`. */
function card(db, { segmentId = 4, kind = "meaning", quote, answer = 1, box = 1, due = TODAY, made = due } = {}) {
  return Number(db.prepare(`INSERT INTO drill_card(run_id, segment_id, kind, origin, written_by, quote, question, options, answer, why, base_version, box, due_on, made_on)
    VALUES (1, ?, ?, 'claude', 'translator', ?, '이 말은?', '["가","나","다","라"]', ?, '문맥이 정한다', 1, ?, ?, ?)`).run(segmentId, kind, quote, answer, box, due, made).lastInsertRowid)
}
function challenge(db, { quote = "말을 아끼면서도 잘 통했다", proposal = "말을 아끼면서도 유난히 잘 통했다", made = TODAY } = {}) {
  return Number(db.prepare(`INSERT INTO drill_card(run_id, segment_id, kind, origin, written_by, quote, question, proposal, why, base_version, due_on, made_on)
    VALUES (1, 4, 'challenge', 'claude', 'agent', ?, 'unusually가 빠졌습니다', ?, 'unusually communicative', 1, ?, ?)`).run(quote, proposal, made, made).lastInsertRowid)
}
const ids = (s) => s.cards.map((c) => c.id)
const today = (db, day = TODAY) => sessionToday(db, { today: day })

test("the sentence a quote is in", () => {
  const p = "He didn't say any more. In consequence, I'm inclined to reserve all judgments, a habit. “Just remember,” he said. The end"
  assert.equal(sentenceAround(p, "reserve all"), "In consequence, I'm inclined to reserve all judgments, a habit.")
  assert.equal(sentenceAround(p, "He didn't"), "He didn't say any more.")
  assert.equal(sentenceAround(p, "Just remember"), "“Just remember,” he said.")
  assert.equal(sentenceAround(p, "The end"), "The end")
  assert.equal(sentenceAround(p, "nowhere"), p)
})

test("today: reviews due, then new cards, each with its sentence and options but not its answer", () => {
  const db = gatsby()
  const fresh = card(db, { quote: "veteran bores" })
  const review = card(db, { quote: "curious natures", box: 3, due: TODAY, made: "2026-10-10" })
  db.prepare("INSERT INTO drill_review(card_id, answered_on, choice, correct, first) VALUES (?, '2026-10-15', 1, 1, 1)").run(review)
  card(db, { quote: "reserve all judgments", due: addDays(TODAY, 1) })  // not yet
  const s = today(db)
  assert.deepEqual(ids(s), [review, fresh])
  assert.deepEqual(s.cards[1], {
    id: fresh, segmentId: 4, chapterId: 1, kind: "meaning", origin: "claude", isNew: true, box: 1, again: false, quote: "veteran bores",
    sentence: "In consequence, I'm inclined to reserve all judgments, a habit that has opened up many curious natures to me and also made me the victim of not a few veteran bores.",
    question: "이 말은?", options: ["가", "나", "다", "라"],
  })
  assert.equal(s.cards[0].isNew, false)
})

test("a right first answer moves the card up and off today; a wrong one comes back until it is right, and only the first counts", () => {
  const db = gatsby()
  const a = card(db, { quote: "veteran bores", answer: 1 })
  const b = card(db, { quote: "curious natures", answer: 2 })
  assert.deepEqual(answerCard(db, { id: a, choice: 1, today: TODAY }),
    { id: a, correct: true, answer: 1, why: "문맥이 정한다", translation: KO4, first: true, again: false, box: 2, dueOn: "2026-10-21", status: "active" })
  const wrong = answerCard(db, { id: b, choice: 0, today: TODAY })
  assert.deepEqual([wrong.correct, wrong.answer, wrong.box, wrong.dueOn, wrong.again], [false, 2, 1, "2026-10-20", true])
  assert.deepEqual(today(db).cards.map((c) => [c.id, c.again]), [[b, true]])
  answerCard(db, { id: b, choice: 3, today: TODAY })  // wrong again: still there
  assert.deepEqual(ids(today(db)), [b])
  const right = answerCard(db, { id: b, choice: 2, today: TODAY })
  assert.deepEqual([right.correct, right.first, right.box, right.dueOn], [true, false, 1, "2026-10-20"])  // practice moves nothing
  assert.deepEqual(ids(today(db)), [])
  assert.throws(() => answerCard(db, { id: a, choice: 1, today: TODAY }), /not asked today/)
  assert.deepEqual(ids(today(db, "2026-10-20")), [b])
  assert.deepEqual(ids(today(db, "2026-10-21")), [b, a])  // b, not answered on its day, is the older due
})

test("right in box 5 a card is learned and asked no more", () => {
  const db = gatsby()
  const a = card(db, { quote: "veteran bores", box: 5 })
  assert.equal(answerCard(db, { id: a, choice: 1, today: TODAY }).status, "learned")
  assert.deepEqual(ids(today(db, addDays(TODAY, 100))), [])
  assert.equal(today(db).stats.learned, 1)
})

test("ten new cards a day, more on asking for that day only; reviews are not limited by new ones", () => {
  const db = gatsby()
  const words = ["He didn't", "say any more", "always been", "unusually communicative", "in a reserved way", "I understood", "he meant",
    "a great deal more", "In consequence", "I'm inclined", "reserve all judgments", "a habit"]  // each once in ¶4
  const made = words.map((w) => card(db, { segmentId: 4, quote: w }))
  const s = today(db)
  assert.equal(s.cards.length, DAILY.cards)
  assert.deepEqual(s.waiting, { cards: 2, challenges: 0 })
  for (const id of made.slice(0, 3)) answerCard(db, { id, choice: 1, today: TODAY })
  assert.equal(today(db).cards.length, 7)  // the day's ten, three of them done
  moreToday(db, { kind: "cards", today: TODAY })
  assert.deepEqual([today(db).cards.length, today(db).waiting.cards], [9, 0])
  assert.equal(today(db, "2026-10-20").cards.length, 9)  // tomorrow: ten again, the More gone
})

test("I know this and Answer looks wrong take a card out; a corrected source makes one stale", () => {
  const db = gatsby()
  const a = card(db, { quote: "veteran bores" })
  const b = card(db, { quote: "curious natures" })
  const c = card(db, { quote: "reserve all judgments" })
  assert.deepEqual(setCardAside(db, { id: a, why: "known", today: TODAY }), { id: a, status: "known" })
  setCardAside(db, { id: b, why: "disputed", today: TODAY })
  assert.throws(() => setCardAside(db, { id: a, why: "known", today: TODAY }), /is known/)
  assert.throws(() => answerCard(db, { id: b, choice: 1, today: TODAY }), /is disputed/)
  execute(db, "updateSegment", { id: 4, text: db.prepare("SELECT source_text FROM segment WHERE id = 4").get().source_text.replace("reserve all judgments", "reserve every judgment") })
  assert.deepEqual(ids(today(db)), [])
  assert.equal(db.prepare("SELECT status FROM drill_card WHERE id = ?").get(c).status, "stale")
  assert.equal(today(db).stats.setAside, 2)
})

test("three challenges a day; deciding one counts it; More brings three more", () => {
  const db = gatsby()
  const ch = [1, 2, 3, 4].map((i) => challenge(db, { quote: i === 1 ? "말을 아끼면서도 잘 통했다" : ["판단을", "버릇이", "생겼다"][i - 2], proposal: "다른 말" }))
  let s = today(db)
  assert.deepEqual(s.challenges.map((c) => c.id), ch.slice(0, 3))
  assert.deepEqual(s.waiting.challenges, 1)
  assert.deepEqual(s.challenges[0], {
    id: ch[0], segmentId: 4, chapterId: 1, writtenBy: "agent", quote: "말을 아끼면서도 잘 통했다", proposal: "다른 말", question: "unusually가 빠졌습니다",
    why: "unusually communicative", source: db.prepare("SELECT source_text FROM segment WHERE id = 4").get().source_text, translation: KO4, stale: false,
  })
  assert.deepEqual(closeChallenge(db, { id: ch[0], decision: "keep", today: TODAY }), { id: ch[0], status: "kept" })
  closeChallenge(db, { id: ch[1], decision: "discuss", today: TODAY })
  assert.deepEqual(today(db).challenges.map((c) => c.id), [ch[2]])  // two decided of today's three
  moreToday(db, { kind: "challenges", today: TODAY })
  assert.deepEqual(today(db).challenges.map((c) => c.id), [ch[2], ch[3]])
  assert.throws(() => closeChallenge(db, { id: ch[0], decision: "keep", today: TODAY }), /already kept/)
  assert.throws(() => closeChallenge(db, { id: ch[2], decision: "change", today: TODAY }), /keep or discuss/)
})

test("Use the suggestion changes only those words, as the translator's write, and ⌘Z takes it back and reopens it", () => {
  const db = gatsby()
  const id = challenge(db)
  execute(db, "decideChallenge", { id, decidedOn: TODAY })
  const text = () => db.prepare("SELECT target_text FROM segment WHERE id = 4").get().target_text
  assert.equal(text(), KO4.replace("말을 아끼면서도 잘 통했다", "말을 아끼면서도 유난히 잘 통했다"))
  assert.deepEqual({ ...db.prepare("SELECT status, decided_on FROM drill_card WHERE id = ?").get(id) }, { status: "changed", decided_on: TODAY })
  assert.equal(db.prepare("SELECT actor FROM ops ORDER BY id DESC LIMIT 1").get().actor, "translator")
  undo(db)
  assert.equal(text(), KO4)
  assert.deepEqual({ ...db.prepare("SELECT status, decided_on FROM drill_card WHERE id = ?").get(id) }, { status: "active", decided_on: null })
  assert.deepEqual(today(db).challenges.map((c) => c.id), [id])
  redo(db)
  assert.equal(db.prepare("SELECT status FROM drill_card WHERE id = ?").get(id).status, "changed")
})

test("a challenge whose words left the translation is shown stale and cannot be used", () => {
  const db = gatsby()
  const id = challenge(db)
  execute(db, "updateSegment", { id: 4, targetDoc: doc(KO4.replace("잘 통했다", "통했다")) })
  assert.equal(today(db).challenges[0].stale, true)
  assert.throws(() => execute(db, "decideChallenge", { id, decidedOn: TODAY }), (e) => e.status === 409 && /no longer in it exactly once/.test(e.message))
  assert.deepEqual(closeChallenge(db, { id, decision: "keep", today: TODAY }), { id, status: "kept" })
})

test("today says how the last evening run went, and how often it failed", () => {
  const db = gatsby()
  db.prepare("INSERT INTO drill_run(slot, status, error) VALUES ('2026-10-20', 'failed', 'offline'), ('2026-10-20', 'failed', 'offline')").run()
  const e = sessionToday(db, { today: "2026-10-20", running: true }).evening
  assert.deepEqual({ ...e, last: { ...e.last, finishedAt: null } }, { running: true, last: { slot: "2026-10-20", status: "failed", made: null, error: "offline", finishedAt: null, tries: 2 } })
})

test("picked words: from the paragraph's source, kept once until a run takes them; every change is announced", () => {
  const db = gatsby()
  const heard = []
  watchSession(db, (e) => heard.push(e))
  const a = pickWords(db, { segmentId: 4, quote: " veteran bores ", origin: "picked" })
  assert.deepEqual(pickWords(db, { segmentId: 4, quote: "veteran bores", origin: "asked" }), a)
  assert.throws(() => pickWords(db, { segmentId: 4, quote: "boars", origin: "picked" }), /not in ¶4's source/)
  assert.throws(() => pickWords(db, { segmentId: 4, quote: "", origin: "picked" }), /1 to 200/)
  assert.throws(() => pickWords(db, { segmentId: 99, quote: "x", origin: "picked" }), (e) => e.status === 404)
  assert.throws(() => pickWords(db, { segmentId: 4, quote: "veteran", origin: "guessed" }), /picked or asked/)
  assert.deepEqual(db.prepare("SELECT segment_id, quote, origin FROM drill_pick").all().map((r) => ({ ...r })), [{ segment_id: 4, quote: "veteran bores", origin: "picked" }])
  assert.equal(heard.length, 2)
})
