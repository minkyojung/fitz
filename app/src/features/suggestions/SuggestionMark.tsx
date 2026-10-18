import { useEffect, useRef } from "react"

import type { Suggestion } from "@/data/api"
import { cn } from "cn"
import { useSuggestions } from "./SuggestionsContext"

/** One of Claude's suggestions in the text, in the diff language the spelling marks use: the quoted words struck on
 *  a warning tint, the replacement in green. It only shows: clicking selects its card in the panel, as clicking a
 *  comment does, and nothing changes until the card's Accept. Selected, the same tint is stronger. */
export function SuggestionMark({ suggestion: s, children }: { suggestion: Suggestion; children: React.ReactNode }) {
  const ctx = useSuggestions()
  const selected = ctx?.selected === s.id
  const ref = useRef<HTMLSpanElement>(null)
  // chosen in the panel: bring the words into view
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "nearest" }) }, [selected])
  const pick = (e: React.SyntheticEvent) => { e.stopPropagation(); ctx?.select(s.id) }
  return (
    <span ref={ref} data-suggestion={s.id} data-selected={selected || undefined} title={s.why} role="button" tabIndex={0}
      onClick={pick} onKeyDown={(e) => e.key === "Enter" && pick(e)} className="group cursor-pointer">
      <mark className={cn("border-b-2 border-mark-warning text-inherit line-through decoration-mark-warning-ink box-decoration-clone transition-colors group-hover:bg-mark-warning/70", selected ? "bg-mark-warning/70" : "bg-mark-warning/40")}>
        {children}
      </mark>
      {s.replacement && (
        <>
          {" "}
          <ins className={cn("border-b-2 border-mark-term px-0.5 no-underline box-decoration-clone transition-colors group-hover:bg-mark-term/70", selected ? "bg-mark-term/70" : "bg-mark-term/40")}>
            {s.replacement}
          </ins>
        </>
      )}
    </span>
  )
}
