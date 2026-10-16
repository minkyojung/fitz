import { Fragment } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { SegmentRow } from "./SegmentRow"
import type { Segment, SegmentPatch } from "@/data/api"

interface Props {
  segments: Segment[]
  selectedId: number | null
  onSelect: (segment: Segment) => void
  onPatch: (id: number, patch: SegmentPatch) => Promise<unknown>
}

/** Segments of the current chapter, grouped under the printed page they start on. */
export function SegmentList({ segments, selectedId, onSelect, onPatch }: Props) {
  return (
    <ScrollArea className="h-full">
      <div className="px-4 py-3">
        {segments.map((s, i) => {
          const newPage = i === 0 || segments[i - 1].pageStart !== s.pageStart
          return (
            <Fragment key={s.id}>
              {newPage && (
                <div className="sticky top-0 z-10 -mx-4 mb-1 bg-background/95 px-4 py-1 text-xs text-muted-foreground tabular-nums backdrop-blur">
                  p. {s.pageStart}
                </div>
              )}
              <SegmentRow
                segment={s}
                selected={s.id === selectedId}
                onSelect={() => onSelect(s)}
                onPatch={(patch) => onPatch(s.id, patch)}
              />
            </Fragment>
          )
        })}
      </div>
    </ScrollArea>
  )
}
