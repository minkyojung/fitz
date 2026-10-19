// Session's day (docs/session.md §2, §5): the cards and challenges asked today, and what answering does. The server
// grades: the page sends the option chosen and hears back whether it was right, why, and where the card goes. None of
// this is an edit of the book — only a challenge's Use the suggestion is, a logged command (commands.mjs).
import { findOnce, httpError, inTransaction } from "../commands.mjs"
import { announceSession } from "./cards.mjs"
import { afterAnswer } from "./schedule.mjs"

/** A day's own: new cards, reviews and challenges asked. More adds to the new cards and challenges, that day only. */
export const DAILY = { cards: 10, reviews: 30, challenges: 3 }
export const MORE = { cards: 10, challenges: 3 }

const extraOf = (db, today) => {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'drill_more'").get()
  const more = row ? JSON.parse(row.value) : null
  return more?.on === today ? more : { cards: 0, challenges: 0 }
}

/** The sentence of `text` the quote is in: from the end of the sentence before it to the end of its own. */
export function sentenceAround(text, quote) {
  const at = text.indexOf(quote)
  if (at === -1) return text
  const end = /[.!?…]["”’)\]]*(?=\s|$)/g
  let start = 0
  for (const m of text.slice(0, at).matchAll(end)) start = m.index + m[0].length
  end.lastIndex = at + quote.length
  const after = end.exec(text)
  return text.slice(start, after ? after.index + after[0].length : text.length).trim()
}

/** A card whose words are no longer in its paragraph's source exactly once (the source was corrected since) is not
 *  asked again. */
function setStale(db) {
  const active = db.prepare("SELECT c.id, c.quote, s.source_text FROM drill_card c JOIN segment s ON s.id = c.segment_id WHERE c.kind <> 'challenge' AND c.status = 'active'").all()
  for (const c of active) if (findOnce(c.source_text, c.quote) === -1) db.prepare("UPDATE drill_card SET status = 'stale' WHERE id = ?").run(c.id)
}

const WITH_ANSWERS = `SELECT c.*, s.source_text, s.target_text, s.chapter_id,
    (SELECT count(*) FROM drill_review r WHERE r.card_id = c.id AND r.answered_on < :today) AS before,
    (SELECT count(*) FROM drill_review r WHERE r.card_id = c.id AND r.answered_on = :today) AS todays,
    (SELECT r.correct FROM drill_review r WHERE r.card_id = c.id AND r.answered_on = :today ORDER BY r.id DESC LIMIT 1) AS lastToday
  FROM drill_card c JOIN segment s ON s.id = c.segment_id`

const cardOut = (c, again) => ({
  id: c.id, segmentId: c.segment_id, chapterId: c.chapter_id, kind: c.kind, origin: c.origin, isNew: c.before === 0, box: c.box, again,
  quote: c.quote, sentence: sentenceAround(c.source_text, c.quote), question: c.question, options: JSON.parse(c.options),
})
const challengeOut = (c) => ({
  id: c.id, segmentId: c.segment_id, chapterId: c.chapter_id, writtenBy: c.written_by, quote: c.quote, proposal: c.proposal,
  question: c.question, why: c.why, source: c.source_text, translation: c.target_text ?? "",
  // the translation changed since and the words are not in it exactly once: Use the suggestion cannot place them
  stale: findOnce(c.target_text ?? "", c.quote) === -1,
})

/** Today's Session: the cards to ask — reviews due, then new cards, then those answered wrong today and not yet right —
 *  within the day's limits; the challenges to decide; how many more wait; the last evening run. */
export function sessionToday(db, { today, running = false }) {
  setStale(db)
  const extra = extraOf(db, today)
  const cards = db.prepare(`${WITH_ANSWERS} WHERE c.kind <> 'challenge' AND c.status = 'active' ORDER BY c.due_on, c.made_on, c.id`).all({ today })
  const startedToday = (old) => db.prepare(`SELECT count(DISTINCT r.card_id) AS n FROM drill_review r WHERE r.answered_on = :today
    AND ${old ? "" : "NOT "}EXISTS (SELECT 1 FROM drill_review p WHERE p.card_id = r.card_id AND p.answered_on < :today)`).get({ today }).n
  const due = cards.filter((c) => c.todays === 0 && c.due_on <= today)
  const reviews = due.filter((c) => c.before > 0).slice(0, Math.max(0, DAILY.reviews - startedToday(true)))
  const fresh = due.filter((c) => c.before === 0)
  const newSlots = Math.max(0, DAILY.cards + extra.cards - startedToday(false))
  const again = cards.filter((c) => c.todays > 0 && c.lastToday === 0)

  const challenges = db.prepare(`SELECT c.*, s.source_text, s.target_text, s.chapter_id FROM drill_card c JOIN segment s ON s.id = c.segment_id
    WHERE c.kind = 'challenge' AND c.status = 'active' AND c.made_on <= ? ORDER BY c.made_on, c.id`).all(today)
  const decidedToday = db.prepare("SELECT count(*) AS n FROM drill_card WHERE kind = 'challenge' AND decided_on = ?").get(today).n
  const challengeSlots = Math.max(0, DAILY.challenges + extra.challenges - decidedToday)

  const last = db.prepare("SELECT * FROM drill_run WHERE slot IS NOT NULL ORDER BY id DESC LIMIT 1").get()
  const count = (where) => db.prepare(`SELECT count(*) AS n FROM drill_card WHERE kind <> 'challenge' AND ${where}`).get().n
  return {
    today,
    cards: [...reviews.map((c) => cardOut(c, false)), ...fresh.slice(0, newSlots).map((c) => cardOut(c, false)), ...again.map((c) => cardOut(c, true))],
    challenges: challenges.slice(0, challengeSlots).map(challengeOut),
    waiting: { cards: Math.max(0, fresh.length - newSlots), challenges: Math.max(0, challenges.length - challengeSlots) },
    evening: {
      running,
      last: last ? {
        slot: last.slot, status: last.status, made: last.made, error: last.error, finishedAt: last.finished_at,
        tries: db.prepare("SELECT count(*) AS n FROM drill_run WHERE slot = ? AND status = 'failed'").get(last.slot).n,
      } : null,
    },
    stats: { learning: count("status = 'active'"), learned: count("status = 'learned'"), setAside: count("status IN ('known', 'disputed')") },
  }
}

const cardOf = (db, id, today) => {
  const c = db.prepare(`${WITH_ANSWERS} WHERE c.id = :id`).get({ id, today })
  if (!c) throw httpError(404, `card ${id} not found`)
  return c
}

/** The translator's answer to a card asked today. Right or wrong, the day's first answer moves the card (afterAnswer);
 *  a card answered wrong is asked again that day until it is answered right, and those answers move nothing. */
export function answerCard(db, { id, choice, today }) {
  const c = cardOf(db, id, today)
  if (c.kind === "challenge") throw httpError(400, "a challenge is decided, not answered")
  if (c.status !== "active") throw httpError(409, `card ${id} is ${c.status}`)
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) throw httpError(400, "choice must be 0 to 3")
  const again = c.todays > 0 && c.lastToday === 0
  if (!again && (c.todays > 0 || c.due_on > today)) throw httpError(409, `card ${id} is not asked today`)
  const correct = choice === c.answer
  const first = c.todays === 0
  const next = first ? afterAnswer(c.box, correct, today) : { box: c.box, dueOn: c.due_on, status: c.status }
  inTransaction(db, () => {
    db.prepare("INSERT INTO drill_review(card_id, answered_on, choice, correct, first) VALUES (?, ?, ?, ?, ?)").run(id, today, choice, correct ? 1 : 0, first ? 1 : 0)
    if (first) db.prepare("UPDATE drill_card SET box = ?, due_on = ?, status = ? WHERE id = ?").run(next.box, next.dueOn, next.status, id)
  })
  announceSession(db)
  return { id, correct, answer: c.answer, why: c.why, translation: c.target_text ?? "", first, again: !correct, ...next }
}

/** I know this (`known`: not asked again, and the expression not picked again) or Answer looks wrong (`disputed`). */
export function setCardAside(db, { id, why, today }) {
  if (why !== "known" && why !== "disputed") throw httpError(400, "why must be known or disputed")
  const c = cardOf(db, id, today)
  if (c.kind === "challenge") throw httpError(400, "a challenge is decided, not set aside")
  if (c.status !== "active") throw httpError(409, `card ${id} is ${c.status}`)
  db.prepare("UPDATE drill_card SET status = ?, decided_on = ? WHERE id = ?").run(why, today, id)
  announceSession(db)
  return { id, status: why }
}

/** Keep it or Discuss with Claude: the challenge is decided, the book untouched. (Use the suggestion is the logged
 *  command decideChallenge.) */
export function closeChallenge(db, { id, decision, today }) {
  const status = { keep: "kept", discuss: "discussed" }[decision]
  if (!status) throw httpError(400, "decision must be keep or discuss")
  const c = db.prepare("SELECT status FROM drill_card WHERE id = ? AND kind = 'challenge'").get(id)
  if (!c) throw httpError(404, `challenge ${id} not found`)
  if (c.status !== "active") throw httpError(409, `challenge ${id} is already ${c.status}`)
  db.prepare("UPDATE drill_card SET status = ?, decided_on = ? WHERE id = ?").run(status, today, id)
  announceSession(db)
  return { id, status }
}

/** More today: ten more new cards, or three more challenges, on top of the day's. */
export function moreToday(db, { kind, today }) {
  if (!Object.hasOwn(MORE, kind)) throw httpError(400, "kind must be cards or challenges")
  const extra = extraOf(db, today)
  const next = { on: today, cards: extra.cards, challenges: extra.challenges, [kind]: extra[kind] + MORE[kind] }
  db.prepare("INSERT INTO meta(key, value) VALUES ('drill_more', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next))
  announceSession(db)
  return next
}

/** Words the translator chose from a paragraph's source (Add to Session), or asked Claude about: the next run makes a
 *  card on them. The same words, not yet given to a run, are kept once. */
export function pickWords(db, { segmentId, quote, origin }) {
  if (origin !== "picked" && origin !== "asked") throw httpError(400, "origin must be picked or asked")
  const text = typeof quote === "string" ? quote.trim() : ""
  if (!text || text.length > 200) throw httpError(400, "quote must be 1 to 200 characters")
  const s = db.prepare("SELECT source_text FROM segment WHERE id = ?").get(segmentId)
  if (!s) throw httpError(404, `segment ${segmentId} not found`)
  if (!s.source_text.includes(text)) throw httpError(400, `“${text}” is not in ¶${segmentId}'s source`)
  const same = db.prepare("SELECT id FROM drill_pick WHERE segment_id = ? AND quote = ? AND run_id IS NULL").get(segmentId, text)
  const id = same?.id ?? Number(db.prepare("INSERT INTO drill_pick(segment_id, quote, origin) VALUES (?, ?, ?)").run(segmentId, text, origin).lastInsertRowid)
  announceSession(db)
  return { id }
}
