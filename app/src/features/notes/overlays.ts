/** Resolve a segment's comments and notes to positions in a text (source or target). Pure. */

import type { Comment, Note } from "@/data/api"
import { locateAnchor } from "@/lib/anchor"

export interface CommentSpan { kind: "comment"; start: number; end: number; comment: Comment }
export interface NoteMarker { kind: "note"; at: number; note: Note; /** Not placed yet: shown at the paragraph's end until the translator places it. */ provisional: boolean }

export function commentSpans(text: string, comments: Comment[], segmentId: number, side: "source" | "target"): CommentSpan[] {
  return comments
    .filter((c) => c.segmentId === segmentId && c.side === side && c.parentId === null && !c.resolved && c.anchor)
    .flatMap((c) => { const at = locateAnchor(text, c.anchor!); return at ? [{ kind: "comment" as const, start: at.start, end: at.end, comment: c }] : [] })
    .sort((a, b) => a.start - b.start)
}

/** Footnote markers sit right after their anchored quote in the translation. With `tail`, author's notes
 *  that have no place yet (or whose anchor no longer matches) sit at the end of the text, provisionally. */
export function noteMarkers(text: string, notes: Note[], segmentId: number, tail = false): NoteMarker[] {
  return notes
    .filter((n) => n.segmentId === segmentId)
    .flatMap((n) => {
      const at = n.targetAnchor ? locateAnchor(text, n.targetAnchor) : null
      if (at) return [{ kind: "note" as const, at: at.end, note: n, provisional: false }]
      return tail && n.kind === "author" && text.length ? [{ kind: "note" as const, at: text.length, note: n, provisional: true }] : []
    })
    .sort((a, b) => a.at - b.at || (a.provisional ? 1 : 0) - (b.provisional ? 1 : 0) || a.note.id - b.note.id)
}
