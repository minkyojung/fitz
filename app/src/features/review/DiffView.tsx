import { useMemo } from "react"

import { diffText } from "@/lib/diffText"
import { cn } from "cn"

interface Props {
  before: string
  after: string
  className?: string
}

/** Unified, word-level diff of a paragraph: removed words struck through in red, added words on green. */
export function DiffView({ before, after, className }: Props) {
  const pieces = useMemo(() => diffText(before, after), [before, after])
  if (before === after) return <p className={cn("reading text-[13px] text-muted-foreground", className)} lang="en">변경 없음</p>
  return (
    <p className={cn("reading text-[13px]", className)} lang="en">
      {pieces.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "removed" ? (
          <del key={i} className="rounded-sm bg-mark-warning/60 px-0.5 text-destructive line-through decoration-destructive/60">
            {p.text}
          </del>
        ) : (
          <ins key={i} className="rounded-sm bg-mark-term px-0.5 no-underline">
            {p.text}
          </ins>
        ),
      )}
    </p>
  )
}
