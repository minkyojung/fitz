// Claude's suggestions (docs/agent.md §4): what the review and the OCR-error hunt found, kept in book.db until the
// translator decides each. Claude only finds; saving a suggestion changes nothing in the book.
import { findOnce, inTransaction, suggestionRow } from "../commands.mjs"
import { TASKS, parseAnswer } from "./tasks.mjs"

// New suggestions are not a change to the book (they are not undone), so they have their own announcement; deciding
// one is a book command, announced as every change is (commands.mjs watchChanges).
const watchers = new WeakMap()  // db → Set<({ segmentIds }) => void>
/** Returns the function that stops watching. */
export const watchSuggestions = (db, fn) => {
  if (!watchers.has(db)) watchers.set(db, new Set())
  watchers.get(db).add(fn)
  return () => watchers.get(db).delete(fn)
}

const textOf = (seg, side) => (side === "source" ? seg.source_text : seg.target_text) ?? ""
const SIDE = { source: "source", target: "translation" }

/** Keep a task's answer. A suggestion is kept only if its quote is in its paragraph exactly once — so it points at
 *  one place — changes something, and does not overlap an open suggestion on the same words (a second run on the
 *  chapter, or two of one answer). It is kept with the paragraph's version then. The rest come back with why. */
export function saveSuggestions(db, { conversationId, task, answer }) {
  const { side } = TASKS[task]
  const segment = db.prepare("SELECT id, source_text, target_text, version FROM segment WHERE id = ?")
  const open = db.prepare("SELECT quote FROM agent_suggestion WHERE segment_id = ? AND side = ? AND status = 'open'")
  const insert = db.prepare(`INSERT INTO agent_suggestion(conversation_id, task, segment_id, side, quote, replacement, why, level, base_version)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
  const suggestions = parseAnswer(task, answer)
  const kept = inTransaction(db, () => {
    const saved = []
    const skipped = []
    for (const s of suggestions) {
      const seg = segment.get(s.segmentId)
      const text = seg ? textOf(seg, side) : ""
      const at = findOnce(text, s.quote)
      const overlaps = (quote) => { const o = text.indexOf(quote); return o !== -1 && o < at + s.quote.length && at < o + quote.length }
      const why = !seg ? `there is no ¶${s.segmentId}`
        : at === -1 ? (text.includes(s.quote) ? `the quote appears more than once in ¶${seg.id}'s ${SIDE[side]}` : `the quote is not in ¶${seg.id}'s ${SIDE[side]}`)
        : s.replacement === s.quote ? "the replacement changes nothing"
        : open.all(seg.id, side).some((o) => overlaps(o.quote)) ? "it overlaps an open suggestion"
        : null
      if (why) { skipped.push({ suggestion: s, why }); continue }
      saved.push(suggestionRow(insert.get(conversationId, task, seg.id, side, s.quote, s.replacement, s.why, s.level ?? null, seg.version)))
    }
    return { saved, skipped }
  })
  if (kept.saved.length) {
    const change = { segmentIds: [...new Set(kept.saved.map((s) => s.segmentId))] }
    for (const fn of watchers.get(db) ?? []) {
      try { fn(change) } catch (e) { console.error("suggestion watcher failed:", e) }
    }
  }
  return kept
}
