// Session's cards (docs/session.md §2–3, §6): what a run gives Claude to read, and what it keeps of the answer.
// The answer came from a model, so it is checked again here and only what holds is kept. Nothing here is a logged
// command: a quiz is not an edit of the book, and ⌘Z never meets it.
import { DRILL } from "../agent/tasks.mjs"
import { findOnce, inTransaction } from "../commands.mjs"

/** The paragraph whose translation a logged change wrote, or null. updateSegment logs whole states, so it wrote a
 *  translation when its translation differs from the one before; accepting a review suggestion writes one too. */
function translationWritten(db, row) {
  const p = JSON.parse(row.params)
  if (row.name === "updateSegment") {
    const before = JSON.parse(row.inverse_params).targetDoc ?? null
    return p.targetDoc && JSON.stringify(p.targetDoc) !== JSON.stringify(before) ? p.id : null
  }
  if (row.name === "decideSuggestion" && p.decision === "accept") {
    const s = db.prepare("SELECT segment_id, side FROM agent_suggestion WHERE id = ?").get(p.id)
    return s?.side === "target" ? s.segment_id : null
  }
  return null
}

/** The paragraphs whose translation a standing change wrote — logged since `since` (when the last evening run began,
 *  as SQLite keeps times; null: ever), or in the last `days` days — that still have a translation, in book order. The
 *  translator's changes and Claude's alike. By time, not ops.id: an undone change at the top is deleted by its
 *  writer's next one, whose id is then the same again (ops has no AUTOINCREMENT). A change in the very second a run
 *  began is in both runs' material; that only repeats, never misses. */
export function changedParagraphs(db, { since = null, days } = {}) {
  const rows = days ? db.prepare("SELECT * FROM ops WHERE undone = 0 AND created_at >= datetime('now', ?) ORDER BY id").all(`-${days} days`)
    : db.prepare("SELECT * FROM ops WHERE undone = 0 AND created_at >= ? ORDER BY id").all(since ?? "")
  const ids = new Set(rows.map((r) => translationWritten(db, r)).filter((id) => id !== null))
  return inBookOrder(db, [...ids]).filter((s) => s.target_text?.trim()).map((s) => s.id)
}

const inBookOrder = (db, ids) => ids.length === 0 ? [] : db.prepare(
  `SELECT s.id, s.target_text FROM segment s JOIN chapter c ON c.id = s.chapter_id WHERE s.id IN (${ids.map(() => "?").join(",")}) ORDER BY c.idx, s.idx`,
).all(...ids)

/** Who last wrote a paragraph's translation, of the standing changes: the translator or Claude. */
export function writtenBy(db, segmentId) {
  const rows = db.prepare("SELECT * FROM ops WHERE undone = 0 AND EXISTS (SELECT 1 FROM json_each(ops.segment_ids) WHERE value = ?) ORDER BY id DESC").iterate(segmentId)
  for (const row of rows) if (translationWritten(db, row) === segmentId) return row.actor
  return "translator"
}

const norm = (quote) => quote.trim().toLowerCase().replace(/\s+/g, " ")
const quotes = (rows) => rows.map((r) => r.quote)

/** What a run gives Claude: the paragraphs to read (those changed in `scope`, see changedParagraphs, and those the
 *  translator picked words from), the picked words not yet given to a run, the expressions the translator knows, and
 *  those these paragraphs already have cards on. */
export function drillInput(db, scope) {
  const picks = db.prepare(`SELECT p.id, p.segment_id AS segmentId, p.quote, p.origin FROM drill_pick p JOIN segment s ON s.id = p.segment_id
                            WHERE p.run_id IS NULL ORDER BY p.id`).all().map((r) => ({ ...r }))
  const changed = changedParagraphs(db, scope)
  const ids = inBookOrder(db, [...new Set([...changed, ...picks.map((p) => p.segmentId)])]).map((s) => s.id)
  const known = quotes(db.prepare("SELECT DISTINCT quote FROM drill_card WHERE kind <> 'challenge' AND status = 'known' ORDER BY id DESC LIMIT 300").all())
  const existing = ids.length === 0 ? [] : quotes(db.prepare(
    `SELECT DISTINCT quote FROM drill_card WHERE kind <> 'challenge' AND status IN ('active', 'learned') AND segment_id IN (${ids.map(() => "?").join(",")})`,
  ).all(...ids))
  return { ids, picks, known, existing }
}

/** The options in a random order, and where the right one went. Measured: Claude puts the right option first. */
export function shuffled(options, answer, random = Math.random) {
  const order = options.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return { options: order.map((i) => options[i]), answer: order.indexOf(answer) }
}

/** Keeps the cards of a run's answer that hold, as of `today`: a quote exactly once in the paragraph it names (one
 *  of those given), four different options, not an expression the translator knows or already has a card on, within
 *  the limits; a challenge's quote exactly once in a translation, and a proposal that changes it. Options are
 *  shuffled. A card on a word the translator picked is theirs (`origin`); the picks given are spent either way.
 *  Returns how many were kept and why the rest were not. Throws if the answer is not of the task's shape. */
export function saveCards(db, { runId, answer, input, today, random = Math.random }) {
  const parsed = DRILL.schema.safeParse(answer)
  if (!parsed.success) throw new Error(`the drill answer does not have the agreed shape: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`)
  const given = new Set(input.ids)
  const segment = (id) => given.has(id) ? db.prepare("SELECT id, source_text, target_text, version FROM segment WHERE id = ?").get(id) : undefined
  const taken = new Set([...input.known, ...quotes(db.prepare("SELECT quote FROM drill_card WHERE kind <> 'challenge' AND status IN ('active', 'learned', 'known')").all())].map(norm))
  const onParagraph = new Map()
  const kept = []
  const dropped = []
  const drop = (c, kind, why) => dropped.push({ kind, segmentId: c.segmentId, quote: c.quote, why })

  for (const c of parsed.data.cards) {
    const s = segment(c.segmentId)
    const why = !s ? "not one of the paragraphs given"
      : findOnce(s.source_text, c.quote) === -1 ? "the quote is not in the source exactly once"
      : new Set(c.options.map((o) => o.trim())).size !== 4 ? "the options are not four different ones"
      : taken.has(norm(c.quote)) ? "the translator knows it or has a card on it"
      : (onParagraph.get(s.id) ?? 0) >= DRILL.limits.perParagraph ? "too many cards on one paragraph"
      : kept.filter((k) => k.kind !== "challenge").length >= DRILL.limits.cards ? "too many cards" : null
    if (why) { drop(c, c.kind, why); continue }
    taken.add(norm(c.quote))
    onParagraph.set(s.id, (onParagraph.get(s.id) ?? 0) + 1)
    const pick = input.picks.find((p) => p.segmentId === s.id && (norm(c.quote).includes(norm(p.quote)) || norm(p.quote).includes(norm(c.quote))))
    kept.push({ ...c, ...shuffled(c.options, c.answer, random), proposal: null, origin: pick?.origin ?? "claude", version: s.version })
  }
  for (const c of parsed.data.challenges) {
    const s = segment(c.segmentId)
    const why = !s ? "not one of the paragraphs given"
      : !s.target_text ? "the paragraph has no translation"
      : findOnce(s.target_text, c.quote) === -1 ? "the quote is not in the translation exactly once"
      : c.proposal.trim() === c.quote.trim() ? "the proposal changes nothing"
      : kept.filter((k) => k.kind === "challenge").length >= DRILL.limits.challenges ? "too many challenges" : null
    if (why) { drop(c, "challenge", why); continue }
    kept.push({ ...c, kind: "challenge", options: null, answer: null, origin: "claude", version: s.version })
  }

  const insert = db.prepare(`INSERT INTO drill_card(run_id, segment_id, kind, origin, written_by, quote, question, options, answer, proposal, why, base_version, due_on, made_on)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  inTransaction(db, () => {
    for (const c of kept) {
      insert.run(runId, c.segmentId, c.kind, c.origin, writtenBy(db, c.segmentId), c.quote, c.question, c.options && JSON.stringify(c.options),
        c.answer, c.proposal, c.why, c.version, today, today)
    }
    for (const p of input.picks) db.prepare("UPDATE drill_pick SET run_id = ? WHERE id = ?").run(runId, p.id)
  })
  return { made: kept.length, dropped }
}
