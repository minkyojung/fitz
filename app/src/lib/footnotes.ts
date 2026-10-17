/** Footnote markers for a chapter: author's notes are numbered in reading order, translator's notes get an asterisk.
 *  An author's note not yet placed in the translation counts at the end of its paragraph, so the numbering is
 *  complete from the start and only the position changes when the translator places it.
 *  Nothing is stored; the final numbering scheme is decided at export. */

export interface NoteRef {
  id: number
  kind: "author" | "translator"
  segmentIdx: number
  /** Position inside the translation, or null when the note has not been placed yet. */
  start: number | null
}

export function footnoteMarkers(notes: NoteRef[]): Map<number, string> {
  const pos = (n: NoteRef) => (n.start === null ? Number.POSITIVE_INFINITY : n.start)
  const ordered = [...notes].sort((a, b) => a.segmentIdx - b.segmentIdx || pos(a) - pos(b) || a.id - b.id)
  const out = new Map<number, string>()
  let n = 0
  for (const note of ordered) out.set(note.id, note.kind === "author" ? String(++n) : "*")
  return out
}
