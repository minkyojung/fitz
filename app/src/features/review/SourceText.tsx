import { Fragment, useMemo } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { diffText, type Piece } from "@/lib/diffText"

interface Props {
  text: string
  ocr: string | null
}

/** Paragraph text with edits against the OCR original highlighted in place.
 *  Added words get a background; the removed original shows in a tooltip on hover. */
export function SourceText({ text, ocr }: Props) {
  // `ocr == null` also covers responses from a server that predates the ocrText field
  const pieces = useMemo(() => (ocr == null || ocr === text ? null : diffText(ocr, text)), [ocr, text])
  if (!pieces) return <>{text}</>

  const out: React.ReactNode[] = []
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    if (p.kind === "same") {
      out.push(<Fragment key={i}>{p.text}</Fragment>)
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
    out.push(
      <Tooltip key={i}>
        <TooltipTrigger
          render={
            <mark
              data-edit
              className={added ? "rounded-sm bg-mark-comment px-0.5 text-inherit" : "inline-block w-0.5 bg-mark-warning align-baseline"}
              aria-label={removed ? `원문: ${removed.text.trim()}` : "추가됨"}
            />
          }
        >
          {added ? added.text : "​"}
        </TooltipTrigger>
        <TooltipContent side="top">
          {removed ? (
            <span>
              원문: <span className="line-through opacity-70">{removed.text.trim()}</span>
            </span>
          ) : (
            "추가됨"
          )}
        </TooltipContent>
      </Tooltip>,
    )
  }
  return <>{out}</>
}
