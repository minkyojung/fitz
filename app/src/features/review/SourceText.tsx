import { Fragment } from "react"

import { neighbours } from "@/lib/rank"
import type { Suspect } from "@/lib/spell"
import type { TermHit } from "@/lib/glossary"
import { SpellMark } from "./SpellMark"
import { GlossaryMark } from "./GlossaryMark"

interface Props {
  text: string
  /** Dictionary suspects in `text` (absolute offsets). */
  suspects?: Suspect[]
  onAcceptFix?: (suspect: Suspect, replacement: string) => void
  /** Glossary terms in `text` (absolute offsets). Never overlap suspects: glossary terms are known words. */
  terms?: TermHit[]
  /** Render only this slice of `text` (offsets stay absolute), so a parent can lay other overlays around it. */
  from?: number
  to?: number
}

type Overlay = { start: number; end: number; kind: "suspect"; suspect: Suspect } | { start: number; end: number; kind: "term"; hit: TermHit }

/** Paragraph text with overlays that call for action: spelling suspects and glossary terms.
 *  Edits against the OCR original are not coloured here; the row shows an "edited" dot instead. */
export function SourceText({ text, suspects = [], onAcceptFix, terms = [], from = 0, to = text.length }: Props) {
  const inside = (a: { start: number; end: number }) => a.start >= from && a.end <= to
  const overlays: Overlay[] = [
    ...suspects.filter(inside).map((s) => ({ start: s.start, end: s.end, kind: "suspect" as const, suspect: s })),
    ...terms.filter(inside).map((t) => ({ start: t.start, end: t.end, kind: "term" as const, hit: t })),
  ].sort((a, b) => a.start - b.start)
  if (!overlays.length) return <>{text.slice(from, to)}</>
  const out: React.ReactNode[] = []
  let pos = from
  for (const o of overlays) {
    if (o.start < pos) continue // overlap: keep the earlier mark
    out.push(<Fragment key={`t${pos}`}>{text.slice(pos, o.start)}</Fragment>)
    out.push(
      o.kind === "suspect" ? (
        <SpellMark key={o.start} suspect={o.suspect} context={neighbours(text, o.start, o.end)} onAccept={(r) => onAcceptFix?.(o.suspect, r)} />
      ) : (
        <GlossaryMark key={o.start} entry={o.hit.entry}>{text.slice(o.start, o.end)}</GlossaryMark>
      ),
    )
    pos = o.end
  }
  out.push(<Fragment key="tail">{text.slice(pos, to)}</Fragment>)
  return <>{out}</>
}
