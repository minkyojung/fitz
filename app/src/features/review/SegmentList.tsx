import { Fragment, useEffect, useRef } from "react"

import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "cn"
import type { Segment, SegmentKind } from "@/data/api"

export const KIND_LABEL: Record<SegmentKind, string> = {
  paragraph: "단락",
  heading: "제목",
  blockquote: "인용",
  caption: "캡션",
  verse: "운문",
}

interface Props {
  segments: Segment[]
  selectedId: number | null
  onSelect: (segment: Segment) => void
}

/** Segments of the current chapter, grouped under the printed page they start on. */
export function SegmentList({ segments, selectedId, onSelect }: Props) {
  const selectedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" })
  }, [selectedId])

  return (
    <ScrollArea className="h-full">
      <div className="px-4 py-3">
        {segments.map((s, i) => {
          const newPage = i === 0 || segments[i - 1].pageStart !== s.pageStart
          const selected = s.id === selectedId
          return (
            <Fragment key={s.id}>
              {newPage && (
                <div className="sticky top-0 z-10 -mx-4 mb-1 bg-background/95 px-4 py-1 text-xs text-muted-foreground tabular-nums backdrop-blur">
                  p. {s.pageStart}
                </div>
              )}
              <div
                ref={selected ? selectedRef : undefined}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(s)}
                onKeyDown={(e) => e.key === "Enter" && onSelect(s)}
                className={cn(
                  "group mb-2 rounded-md border border-transparent px-2 py-1.5 outline-none",
                  "hover:bg-muted/50 focus-visible:border-ring",
                  selected && "border-border bg-muted/60",
                  s.verified && "opacity-60",
                )}
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs">
                  <Badge variant={s.kind === "paragraph" ? "outline" : "secondary"}>{KIND_LABEL[s.kind]}</Badge>
                  {s.pageEnd !== s.pageStart && (
                    <span className="text-muted-foreground tabular-nums">→ p. {s.pageEnd}</span>
                  )}
                  {s.verified && <span className="ml-auto text-muted-foreground">확인됨</span>}
                </div>
                <p className={cn("reading text-[15px]", s.kind === "heading" && "font-semibold")} lang="en">
                  {s.sourceText}
                </p>
              </div>
            </Fragment>
          )
        })}
      </div>
    </ScrollArea>
  )
}
