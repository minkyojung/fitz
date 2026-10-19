// The checks on what Claude translated (docs/agent.md §19): the app runs them, Claude's word is not evidence. Pure
// reading — nothing here writes — so the same book gives the same verdict. Two rules, both ones Claude can act on:
//   term  the source has a glossary term; the translation has none of its agreed forms (the editor's own rule)
//   note  an author's or translator's note had its place in the translation; the words it was placed at are gone
// An author's note never placed yet is not Claude's to place (it has no tool for that), so it is not a failure here.
import { anchorOf } from "../commands.mjs"
import { locateAnchor } from "../anchor.mjs"
import { acceptedForms, missingForms, termPattern } from "./glossaryRule.mjs"

/** What is wrong with these paragraphs' translations, paragraph by paragraph; [] when nothing is. */
export function checkSegments(db, ids) {
  const glossary = db.prepare("SELECT term, translation, aliases FROM glossary").all().filter((e) => e.term.trim() && e.translation.trim())
  const segment = db.prepare("SELECT id, source_text, target_text FROM segment WHERE id = ?")
  const notes = db.prepare("SELECT * FROM note WHERE segment_id = ? ORDER BY id")
  const failures = []
  for (const id of [...new Set(ids)]) {
    const s = segment.get(id)
    const target = s?.target_text ?? ""
    if (!target.trim()) continue
    const inSource = glossary.filter((e) => termPattern(e.term).test(s.source_text))
    for (const e of missingForms(inSource, target)) failures.push({ segmentId: id, kind: "term", term: e.term, forms: acceptedForms(e) })
    for (const n of notes.all(id)) {
      const at = anchorOf(n, "tgt")
      if (at && !locateAnchor(target, at)) failures.push({ segmentId: id, kind: "note", noteId: n.id, noteKind: n.kind, quote: at.exact })
    }
  }
  return failures
}

/** The failures as Claude is told them when its turn is sent back: where, what, and what would make it right — and
 *  leave to say a form is right as it is (a term used in another sense, a wording the translator asked for), so a
 *  right translation is not rewritten and the translator's word is not overruled by the glossary. */
export function reasonFor(failures) {
  const line = (f) => f.kind === "term"
    ? `- ¶${f.segmentId}: the source has “${f.term}”; the glossary's agreed form is “${f.forms[0]}”${f.forms.length > 1 ? ` (also accepted: ${f.forms.slice(1).join(", ")})` : ""}, and the translation has none of them.`
    : `- ¶${f.segmentId}: the ${f.noteKind === "author" ? "author's" : "translator's"} note ${f.noteId} was placed after “${f.quote}” in the translation, and those words are gone. Keep them, so the note keeps its place.`
  return [
    "fitz checked the translations you wrote this turn and found:",
    ...failures.map(line),
    "Fix these with set_translation (read the paragraph again for its version), then stop. If one is right as it is (a term used in another sense, or the wording the translator asked you for), leave it, say why in one line and stop.",
  ].join("\n")
}
