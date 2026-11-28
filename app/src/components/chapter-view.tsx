import type { Chapter, Doc, Segment } from "@shared/protocol.ts"

import { LoadError } from "@/components/load-error"
import { Skeleton } from "@/components/ui/skeleton"
import { request } from "@/data/api"
import { useLoad } from "@/hooks/use-load"
import { cn } from "@/lib/utils"

/** A chapter's paragraphs: the source on the left, its translation on the right. */
export function ChapterView({ chapter, changes }: {
  chapter: Chapter
  /** Counts the book's changes: a new number loads the paragraphs again. */
  changes: number
  /** Called once this view has changed the book. */
  onChanged: () => void
}) {
  const loaded = useLoad(chapter.id, (signal) => request("listSegments", { chapterId: chapter.id }, signal), changes)

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
      {loaded.data.map((segment) => (
        <SegmentRow key={segment.id} segment={segment} />
      ))}
    </div>
  )
}

const KIND_STYLE: Record<Segment["kind"], string> = {
  paragraph: "",
  heading: "text-base font-medium",
  blockquote: "border-l-2 pl-4",
  caption: "text-xs text-muted-foreground",
  verse: "whitespace-pre-wrap",
}

function SegmentRow({ segment }: { segment: Segment }) {
  const side = cn("flex min-w-0 flex-col gap-2 text-sm leading-relaxed", KIND_STYLE[segment.kind])
  return (
    <article data-segment-id={segment.id} className="grid grid-cols-2 gap-8 border-b py-4 last:border-b-0">
      <div data-side="source" lang="en" className={side}>
        <DocText doc={segment.sourceDoc} />
      </div>
      {segment.targetDoc ? (
        <div data-side="target" data-translated="true" lang="ko" className={cn(side, "break-keep")}>
          <DocText doc={segment.targetDoc} />
        </div>
      ) : (
        <div data-side="target" data-translated="false" className="text-sm text-muted-foreground">
          Not translated
        </div>
      )}
    </article>
  )
}

/** The text as the database holds it: one block per paragraph, italic where it is marked. */
function DocText({ doc }: { doc: Doc }) {
  return doc.content.map((paragraph, i) => (
    <p key={i}>
      {(paragraph.content ?? []).map((node, j) =>
        node.marks?.some((mark) => mark.type === "italic") ? <em key={j}>{node.text}</em> : node.text,
      )}
    </p>
  ))
}
