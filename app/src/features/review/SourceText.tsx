import { Fragment, useMemo } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { diffText, type Piece } from "@/lib/diffText"
import { neighbours } from "@/lib/rank"
import type { Suspect } from "@/lib/spell"
import type { TermHit } from "@/lib/glossary"
import { SpellMark } from "./SpellMark"
import { GlossaryMark } from "./GlossaryMark"

interface Props {
  text: string
  ocr: string | null
  /** Dictionary suspects in `text` (absolute offsets). */
  suspects?: Suspect[]
  onAcceptFix?: (suspect: Suspect, replacement: string) => void
  /** Glossary terms in `text` (absolute offsets). Never overlap suspects: glossary terms are known words. */
  terms?: TermHit[]
}

/** Paragraph text with two overlays computed from the text itself (never stored):
 *  edits against the OCR original (background + tooltip) and spelling suspects (SpellMark). */
export function SourceText({ text, ocr, suspects = [], onAcceptFix, terms = [] }: Props) {
  // `ocr == null` also covers responses from a server that predates the ocrText field
  const pieces = useMemo<Piece[]>(
    () => (ocr == null || ocr === text ? [{ text, kind: "same" }] : diffText(ocr, text)),
    [ocr, text],
  )

  const out: React.ReactNode[] = []
  let pos = 0 // absolute offset in `text` (removed pieces take no room)
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    if (p.kind === "same") {
      out.push(<Fragment key={i}>{withOverlays(text, pos, pos + p.text.length, suspects, terms, onAcceptFix)}</Fragment>)
      pos += p.text.length
      continue
    }
    // pair a removal with the addition that follows it
    let removed: Piece | null = null
    let added: Piece | null = null
    if (p.kind === "removed") {
      removed = p
      if (pieces[i + 1]?.kind === "added") added = pieces[++i]
    } else {
      added = p
    }
    if (added) pos += added.text.length
    out.push(
      <Tooltip key={i}>
        <TooltipTrigger
          render={
            <mark
              data-edit
              className={added ? "rounded-sm bg-mark-comment text-inherit box-decoration-clone" : "inline-block w-0.5 bg-mark-warning align-baseline"}
              aria-label={removed ? `Original: ${removed.text.trim()}` : "Added"}
            />
          }
        >
          {added ? added.text : "​"}
        </TooltipTrigger>
        <TooltipContent side="top">
          {removed ? (
            <span>
              Original: <span className="line-through opacity-70">{removed.text.trim()}</span>
            </span>
          ) : (
            "Added"
          )}
        </TooltipContent>
      </Tooltip>,
    )
  }
  return <>{out}</>
}

type Overlay = { start: number; end: number; kind: "suspect"; suspect: Suspect } | { start: number; end: number; kind: "term"; hit: TermHit }

/** Text in [from, to) with spelling suspects and glossary terms inside it rendered as marks. */
function withOverlays(text: string, from: number, to: number, suspects: Suspect[], terms: TermHit[], onAccept?: (s: Suspect, r: string) => void) {
  const inside: Overlay[] = [
    ...suspects.filter((s) => s.start >= from && s.end <= to).map((s) => ({ start: s.start, end: s.end, kind: "suspect" as const, suspect: s })),
    ...terms.filter((t) => t.start >= from && t.end <= to).map((t) => ({ start: t.start, end: t.end, kind: "term" as const, hit: t })),
  ].sort((a, b) => a.start - b.start)
  if (!inside.length) return text.slice(from, to)
  const out: React.ReactNode[] = []
  let pos = from
  for (const o of inside) {
    if (o.start < pos) continue // overlap: keep the earlier mark
    out.push(text.slice(pos, o.start))
    out.push(
      o.kind === "suspect" ? (
        <SpellMark key={o.start} suspect={o.suspect} context={neighbours(text, o.start, o.end)} onAccept={(r) => onAccept?.(o.suspect, r)} />
      ) : (
        <GlossaryMark key={o.start} entry={o.hit.entry}>{text.slice(o.start, o.end)}</GlossaryMark>
      ),
    )
    pos = o.end
  }
  out.push(text.slice(pos, to))
  return out
}
