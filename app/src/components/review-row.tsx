import { useEffect, useRef } from "react"

import type { Segment } from "@shared/protocol.ts"

import { DocText } from "@/components/doc-text"
import { cn } from "@/lib/utils"

export const KIND_LABEL: Record<Segment["kind"], string> = { paragraph: "Paragraph", heading: "Heading", blockquote: "Quote", caption: "Caption", verse: "Verse" }

/** One paragraph of the source, as the review screen shows it: chosen with a click, brought into view when chosen otherwise. */
export function ReviewRow({ segment, selected, onSelect }: { segment: Segment; selected: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  return (
    <article
      ref={ref}
      data-segment-id={segment.id}
      data-selected={selected}
      onClick={onSelect}
      className={cn("flex flex-col gap-1.5 rounded-lg px-3 py-2.5 text-sm", selected ? "bg-muted ring-1 ring-border" : "hover:bg-muted/50")}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{KIND_LABEL[segment.kind]}</span>
        {segment.pageEnd !== segment.pageStart && <span>→ p. {segment.pageEnd}</span>}
      </div>
      <div data-side="source" lang="en" className={cn("flex flex-col gap-2 leading-relaxed", segment.kind === "heading" && "font-medium")}>
        <DocText doc={segment.sourceDoc} />
      </div>
    </article>
  )
}
