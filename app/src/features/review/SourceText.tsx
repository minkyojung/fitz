import { Fragment } from "react"

import type { Suggestion } from "@/data/api"
import { neighbours } from "@/lib/rank"
import type { Suspect } from "@/lib/spell"
import type { TermHit } from "@/lib/glossary"
import type { Placed } from "@/lib/suggestions"
import { SuggestionMark } from "@/features/suggestions/SuggestionMark"
import { SpellMark } from "./SpellMark"
import { GlossaryMark } from "./GlossaryMark"

interface Props {
  text: string
  /** Dictionary suspects in `text` (absolute offsets). */
  suspects?: Suspect[]
  onAcceptFix?: (suspect: Suspect, replacement: string) => void
  /** Glossary terms in `text` (absolute offsets). Never overlap suspects: glossary terms are known words. */
  terms?: TermHit[]
  /** The text is read-only here: a click on a term opens it to set its translation. */
  termsEditable?: boolean
  /** Claude's suggestions laid on `text` (absolute offsets). Where one meets a suspect on the same words, it is shown. */
  suggestions?: Placed<Suggestion>[]
  /** Render only this slice of `text` (offsets stay absolute), so a parent can lay other overlays around it. */
  from?: number
  to?: number
}

type Overlay =
  | { start: number; end: number; kind: "suggestion"; suggestion: Suggestion }
  | { start: number; end: number; kind: "suspect"; suspect: Suspect }
  | { start: number; end: number; kind: "term"; hit: TermHit }

/** Paragraph text with overlays that call for action: Claude's suggestions, spelling suspects and glossary terms.
 *  Edits against the OCR original are not coloured here; the row shows an "edited" dot instead. */
export function SourceText({ text, suspects = [], onAcceptFix, terms = [], termsEditable = false, suggestions = [], from = 0, to = text.length }: Props) {
  const inside = (a: { start: number; end: number }) => a.start >= from && a.end <= to
  // suggestions first: the sort is stable, so on the same words Claude's is the one kept
  const overlays: Overlay[] = [
    ...suggestions.filter(inside).map((p) => ({ start: p.start, end: p.end, kind: "suggestion" as const, suggestion: p.item })),
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
      o.kind === "suggestion" ? (
        <SuggestionMark key={o.start} suggestion={o.suggestion}>{text.slice(o.start, o.end)}</SuggestionMark>
      ) : o.kind === "suspect" ? (
        <SpellMark key={o.start} suspect={o.suspect} context={neighbours(text, o.start, o.end)} onAccept={(r) => onAcceptFix?.(o.suspect, r)} />
      ) : (
        <GlossaryMark key={o.start} entry={o.hit.entry} editable={termsEditable}>{text.slice(o.start, o.end)}</GlossaryMark>
      ),
    )
    pos = o.end
  }
  out.push(<Fragment key="tail">{text.slice(pos, to)}</Fragment>)
  return <>{out}</>
}
