import { Fragment } from "react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SegmentRow } from "./SegmentRow"
import type { Segment, SegmentPatch } from "@/data/api"

interface Props {
  segments: Segment[]
  /** Page shown in the viewer; used to say when it has no segments. */
  pageNo: number | null
  selectedId: number | null
  editingId: number | null
  onSelect: (segment: Segment) => void
  onEditingChange: (id: number | null) => void
  onPatch: (id: number, patch: SegmentPatch) => Promise<unknown>
  onSplit: (id: number, offset: number) => Promise<unknown>
  onMerge: (id: number) => Promise<unknown>
  onStep: (delta: 1 | -1) => void
  /** Add a caption placeholder on the page shown in the viewer. */
  onAddCaption: (pageNo: number) => void
}

/** Segments of the current chapter, grouped under the printed page they start on. */
export function SegmentList({ segments, pageNo, selectedId, editingId, onSelect, onEditingChange, onPatch, onSplit, onMerge, onStep, onAddCaption }: Props) {
  const pageIsEmpty = pageNo !== null && !segments.some((s) => s.pageStart <= pageNo && pageNo <= s.pageEnd)
  return (
    <ScrollArea className="h-full">
      {pageIsEmpty && (
        <div role="status" className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-4 py-2 text-xs">
          <span className="tabular-nums">p. {pageNo}</span>
          <span className="text-muted-foreground">이 쪽에는 단락이 없습니다.</span>
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => onAddCaption(pageNo)}>
            캡션 추가
          </Button>
        </div>
      )}
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
                onStep={onStep}
              />
            </Fragment>
          )
        })}
      </div>
    </ScrollArea>
  )
}
