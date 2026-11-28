import type { Chapter, Segment } from "@shared/protocol.ts"

import { LoadError } from "@/components/load-error"
import { SegmentRow } from "@/components/segment-row"
import { Skeleton } from "@/components/ui/skeleton"
import { request } from "@/data/api"
import { useLoad } from "@/hooks/use-load"
import { useSegmentEdits } from "@/hooks/use-segment-edits"

/** A chapter's paragraphs: the source on the left, its translation on the right, which a click opens for editing. */
export function ChapterView({ chapter, changes, onChanged }: {
  chapter: Chapter
  /** Counts the book's changes: a new number loads the paragraphs again. */
  changes: number
  /** Called once this view has changed what the server holds. */
  onChanged: () => void
}) {
  const loaded = useLoad(chapter.id, (signal) => request("listSegments", { chapterId: chapter.id }, signal), changes)
  const segments: Segment[] = loaded.status === "ready" ? loaded.data : []
  const edits = useSegmentEdits({ side: "target", segments, setSegments: (s) => loaded.status === "ready" && loaded.set(s), onChanged })

  if (loaded.status === "loading")
    return (
      <div className="flex flex-col gap-6 p-4 pt-0" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid grid-cols-2 gap-8">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ))}
      </div>
    )
  if (loaded.status === "error")
    return (
      <div className="p-4 pt-0">
        <LoadError what={`${chapter.title} could not be loaded`} error={loaded.error} retry={loaded.retry} />
      </div>
    )

  return (
    <div className="flex flex-1 flex-col px-4 pb-8">
      {segments.map((segment) => (
        <SegmentRow key={segment.id} segment={segment} target={edits.sideOf(segment)} />
      ))}
    </div>
  )
}
