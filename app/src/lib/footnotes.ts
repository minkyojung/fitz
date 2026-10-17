/** Footnote markers for a chapter: author's notes are numbered in reading order, translator's notes get an asterisk.
 *  Nothing is stored; the final numbering scheme is decided at export. */

export interface NoteRef {
  id: number
  kind: "author" | "translator"
  segmentIdx: number
  /** Position inside the translation, or null when the note has not been placed yet. */
  start: number | null
}

export function footnoteMarkers(notes: NoteRef[]): Map<number, string> {
  const placed = notes.filter((n) => n.start !== null).sort((a, b) => a.segmentIdx - b.segmentIdx || a.start! - b.start!)
  const out = new Map<number, string>()
  let n = 0
  for (const note of placed) out.set(note.id, note.kind === "author" ? String(++n) : "*")
  return out
}
