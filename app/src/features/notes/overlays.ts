/** Resolve a segment's comments and notes to positions in a text (source or target). Pure. */

import type { Comment, Note } from "@/data/api"
import { locateAnchor } from "@/lib/anchor"

export interface CommentSpan { kind: "comment"; start: number; end: number; comment: Comment }
export interface NoteMarker { kind: "note"; at: number; note: Note }

export function commentSpans(text: string, comments: Comment[], segmentId: number, side: "source" | "target"): CommentSpan[] {
  return comments
    .filter((c) => c.segmentId === segmentId && c.side === side && c.parentId === null && !c.resolved && c.anchor)
    .flatMap((c) => { const at = locateAnchor(text, c.anchor!); return at ? [{ kind: "comment" as const, start: at.start, end: at.end, comment: c }] : [] })
    .sort((a, b) => a.start - b.start)
}

/** Footnote markers sit right after their anchored quote in the translation. */
export function noteMarkers(text: string, notes: Note[], segmentId: number): NoteMarker[] {
  return notes
    .filter((n) => n.segmentId === segmentId && n.targetAnchor)
    .flatMap((n) => { const at = locateAnchor(text, n.targetAnchor!); return at ? [{ kind: "note" as const, at: at.end, note: n }] : [] })
    .sort((a, b) => a.at - b.at)
}
