import { Fragment, useMemo } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { diffText, type Piece } from "@/lib/diffText"
import { neighbours } from "@/lib/rank"
import type { Suspect } from "@/lib/spell"
import { SpellMark } from "./SpellMark"

interface Props {
  text: string
  ocr: string | null
  /** Dictionary suspects in `text` (absolute offsets). */
  suspects?: Suspect[]
  onAcceptFix?: (suspect: Suspect, replacement: string) => void
}

/** Paragraph text with two overlays computed from the text itself (never stored):
 *  edits against the OCR original (background + tooltip) and spelling suspects (SpellMark). */
export function SourceText({ text, ocr, suspects = [], onAcceptFix }: Props) {
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
      out.push(<Fragment key={i}>{withSuspects(text, pos, pos + p.text.length, suspects, onAcceptFix)}</Fragment>)
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

/** Text in [from, to) with any suspects inside it rendered as SpellMarks. */
function withSuspects(text: string, from: number, to: number, suspects: Suspect[], onAccept?: (s: Suspect, r: string) => void) {
  const inside = suspects.filter((s) => s.start >= from && s.end <= to)
  if (!inside.length) return text.slice(from, to)
  const out: React.ReactNode[] = []
  let pos = from
  for (const s of inside) {
    out.push(text.slice(pos, s.start))
    out.push(<SpellMark key={s.start} suspect={s} context={neighbours(text, s.start, s.end)} onAccept={(r) => onAccept?.(s, r)} />)
    pos = s.end
  }
  out.push(text.slice(pos, to))
  return out
}
