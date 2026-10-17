import { Fragment } from "react"

import type { Comment, Note } from "@/data/api"
import { CommentMark, FootnoteMark } from "./marks"
import { commentSpans, noteMarkers } from "./overlays"
import { useAnnotations } from "./AnnotationsContext"

interface Props {
  text: string
  segmentId: number
  side: "source" | "target"
  /** Footnote labels by note id (translation side only). */
  markers?: Map<number, string>
  /** This is the paragraph's last block: unplaced author's notes show provisionally at its end. */
  last?: boolean
  /** Renders plain stretches (lets the source side add its own spelling/glossary marks). */
  renderPlain?: (text: string, from: number, to: number) => React.ReactNode
}

/** Text with comment spans and (on the translation) footnote markers laid over it. Nothing stored: positions
 *  come from relocating each annotation's anchor in the current text. */
export function AnnotatedText({ text, segmentId, side, markers, last = false, renderPlain }: Props) {
  const ann = useAnnotations()
  const comments: Comment[] = ann?.annotations.comments ?? []
  const notes: Note[] = ann?.annotations.notes ?? []
  const spans = commentSpans(text, comments, segmentId, side)
  const marks = side === "target" ? noteMarkers(text, notes, segmentId, last) : []
  const plain = (from: number, to: number) => (renderPlain ? renderPlain(text, from, to) : text.slice(from, to))
  if (!spans.length && !marks.length) return <>{plain(0, text.length)}</>

  // walk in order; a footnote marker is a zero-width insertion at `at`
  const events = [
    ...spans.map((s) => ({ at: s.start, end: s.end, span: s, marker: null as null | (typeof marks)[number] })),
    ...marks.map((m) => ({ at: m.at, end: m.at, span: null as null | (typeof spans)[number], marker: m })),
  ].sort((a, b) => a.at - b.at || (a.span ? 1 : -1))
  const out: React.ReactNode[] = []
  let pos = 0
  for (const e of events) {
    if (e.at < pos) continue
    out.push(<Fragment key={`p${pos}`}>{plain(pos, e.at)}</Fragment>)
    if (e.span) {
      const c = e.span.comment
      out.push(
        <CommentMark key={`c${c.id}`} id={c.id} selected={ann?.selected?.kind === "comment" && ann.selected.id === c.id} onSelect={() => ann?.select({ kind: "comment", id: c.id })}>
          {plain(e.at, e.end)}
        </CommentMark>,
      )
      pos = e.end
    } else if (e.marker) {
      const n = e.marker.note
      out.push(
        <FootnoteMark key={`n${n.id}`} id={n.id} label={markers?.get(n.id) ?? (n.kind === "author" ? "#" : "*")} provisional={e.marker.provisional}
          body={n.kind === "author" ? n.bodyTarget || n.bodySource || "" : n.bodyTarget} lang={n.kind === "author" && !n.bodyTarget ? "en" : "ko"}
          selected={ann?.selected?.kind === "note" && ann.selected.id === n.id} onSelect={() => ann?.select({ kind: "note", id: n.id })} />,
      )
      pos = e.at
    }
  }
  out.push(<Fragment key="tail">{plain(pos, text.length)}</Fragment>)
  return <>{out}</>
}
