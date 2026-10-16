import { Fragment } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { SegmentRow } from "./SegmentRow"
import type { Segment, SegmentPatch } from "@/data/api"

interface Props {
  segments: Segment[]
  selectedId: number | null
  editingId: number | null
  onSelect: (segment: Segment) => void
  onEditingChange: (id: number | null) => void
  onPatch: (id: number, patch: SegmentPatch) => Promise<unknown>
  onSplit: (id: number, offset: number) => Promise<unknown>
  onMerge: (id: number) => Promise<unknown>
}

/** Segments of the current chapter, grouped under the printed page they start on. */
export function SegmentList({ segments, selectedId, editingId, onSelect, onEditingChange, onPatch, onSplit, onMerge }: Props) {
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
                editing={s.id === editingId}
                hasNext={i + 1 < segments.length}
                onSelect={() => onSelect(s)}
                onEditingChange={(on) => onEditingChange(on ? s.id : null)}
                onPatch={(patch) => onPatch(s.id, patch)}
                onSplit={(offset) => onSplit(s.id, offset)}
                onMerge={() => onMerge(s.id)}
              />
            </Fragment>
          )
        })}
      </div>
    </ScrollArea>
  )
}
