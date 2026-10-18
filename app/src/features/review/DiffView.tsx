import { useMemo } from "react"

import { diffText } from "@/lib/diffText"
import { cn } from "cn"

interface Props {
  before: string
  after: string
  className?: string
  /** The text's language, for its font; a source paragraph by default. */
  lang?: "en" | "ko"
}

/** Unified, word-level diff of a paragraph: removed words struck through in red, added words on green. */
export function DiffView({ before, after, className, lang = "en" }: Props) {
  const pieces = useMemo(() => diffText(before, after), [before, after])
  if (before === after) return <p className={cn("reading text-[13px] text-muted-foreground", className)} lang={lang}>No changes</p>
  return (
    <p className={cn("reading text-[13px]", className)} lang={lang}>
      {pieces.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "removed" ? (
          <del key={i} className="bg-mark-warning/50 px-0.5 line-through opacity-80">
            {p.text}
          </del>
        ) : (
          <ins key={i} className="bg-mark-term/60 px-0.5 no-underline">
            {p.text}
          </ins>
        ),
      )}
    </p>
  )
}
