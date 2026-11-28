import { Fragment, useState } from "react"
import { usePanelRef } from "react-resizable-panels"
import { toast } from "sonner"

import type { Chapter, Page, Segment, SegmentPatch } from "@shared/protocol.ts"

import { LoadError } from "@/components/load-error"
import { PageViewer } from "@/components/page-viewer"
import { ReviewRow } from "@/components/review-row"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Skeleton } from "@/components/ui/skeleton"
import { request } from "@/data/api"
import { useKeymap } from "@/hooks/use-keymap"
import { useLoad } from "@/hooks/use-load"
import { useSegmentEdits } from "@/hooks/use-segment-edits"
import { chapterForPage } from "@/lib/pages"

const on = (segment: Segment, pageNo: number) => segment.pageStart <= pageNo && pageNo <= segment.pageEnd

/** A chapter's source beside the scan, the two always on the same page: choosing a paragraph turns the scan to it,
 *  turning the scan chooses the page's first paragraph — in another chapter, if the page is past this one's end. */
export function ReviewView({ chapter, chapters, pages, arrivalPage, changes, onChanged, onChapter }: {
  chapter: Chapter
  chapters: Chapter[]
  pages: Page[]
  /** The page to open on, when the chapter was reached by turning the scan. */
  arrivalPage: number | null
  /** Counts the book's changes: a new number loads the paragraphs again. */
  changes: number
  /** Called once this view has changed what the server holds. */
  onChanged: () => void
  /** Turning the scan reached a page of another chapter. */
  onChapter: (chapterId: number, pageNo: number) => void
}) {
  const loaded = useLoad(chapter.id, (signal) => request("listSegments", { chapterId: chapter.id }, signal), changes)
  // undefined: nothing chosen yet, so the arrival page's first paragraph, or the chapter's first
  const [chosen, setChosen] = useState<number | null | undefined>(undefined)
  const [shownPage, setShownPage] = useState<number | null>(arrivalPage)
  const scan = usePanelRef()

  const segments = loaded.status === "ready" ? loaded.data : []
  const selectedId = chosen === undefined ? (segments.find((s) => shownPage === null || on(s, shownPage))?.id ?? null) : chosen
  const selected = segments.find((s) => s.id === selectedId) ?? null
  const pageNo = shownPage ?? selected?.pageStart ?? chapter.startPage ?? pages[0]?.pageNo ?? 0

  const select = (segment: Segment) => {
    setChosen(segment.id)
    setShownPage(segment.pageStart)
  }
  // the source is edited where it is shown; an edit chooses its paragraph, so the scan follows Tab
  const edits = useSegmentEdits({ side: "source", segments, setSegments: (s) => loaded.status === "ready" && loaded.set(s), onChanged, onEditing: select })
  async function merge(segment: Segment) {
    try {
      await request("mergeWithNext", { id: segment.id, expectVersion: segment.version })
    } catch (e) {
      toast.error("The paragraphs were not merged", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      onChanged()
    }
  }
  /** Verify a paragraph or change its kind: one save, named with the version on screen. */
  async function change(segment: Segment, patch: SegmentPatch) {
    try {
      const saved = await request("updateSegment", { id: segment.id, patch, expectVersion: segment.version })
      if (loaded.status === "ready") loaded.set(segments.map((s) => (s.id === saved.id ? saved : s)))
    } catch (e) {
      toast.error("The paragraph was not changed", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      onChanged()
    }
  }
  const turnTo = (n: number) => {
    const first = segments.find((s) => on(s, n))
    if (first) {
      setChosen(first.id)
      setShownPage(n)
      return
    }
    const owner = chapterForPage(chapters, n)
    if (owner && owner.id !== chapter.id) return onChapter(owner.id, n)
    setChosen(null)
    setShownPage(n)
  }
  const step = (by: 1 | -1) => {
    const at = segments.findIndex((s) => s.id === selectedId)
    const next = segments[at === -1 ? 0 : Math.min(segments.length - 1, Math.max(0, at + by))]
    if (next) select(next)
  }
  useKeymap({
    ArrowDown: () => step(1),
    j: () => step(1),
    ArrowUp: () => step(-1),
    k: () => step(-1),
    " ": () => selected && void change(selected, { verified: !selected.verified }),
    Enter: () => selected && edits.edit(selected, "end"),
    "Mod+i": () => (scan.current?.isCollapsed() ? scan.current.expand() : scan.current?.collapse()),
  })

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 border-t">
      <ResizablePanel panelRef={scan} defaultSize="45%" minSize="20%" collapsible collapsedSize={0}>
        <PageViewer pages={pages} pageNo={pageNo} boxes={selected?.boxes ?? []} onPage={turnTo} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="55%" minSize="30%">
        <div className="h-full overflow-auto px-3 pb-8">
          {loaded.status === "loading" && (
            <div className="flex flex-col gap-3 pt-3" aria-busy="true">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          )}
          {loaded.status === "error" && (
            <div className="pt-3">
              <LoadError what={`${chapter.title} could not be loaded`} error={loaded.error} retry={loaded.retry} />
            </div>
          )}
          {loaded.status === "ready" && !segments.some((s) => on(s, pageNo)) && (
            <div data-empty-page role="status" className="sticky top-0 z-10 bg-background py-2 text-sm text-muted-foreground">
              p. {pageNo} · No paragraphs on this page.
            </div>
          )}
          {segments.map((segment, i) => (
            <Fragment key={segment.id}>
              {segment.pageStart !== segments[i - 1]?.pageStart && (
                <h3 className="sticky top-0 z-10 bg-background pt-3 pb-1 text-xs font-medium text-muted-foreground">p. {segment.pageStart}</h3>
              )}
              <ReviewRow
                segment={segment}
                selected={segment.id === selectedId}
                source={edits.sideOf(segment)}
                hasNext={i < segments.length - 1}
                onSelect={() => select(segment)}
                onVerify={(verified) => void change(segment, { verified })}
                onKind={(kind) => void change(segment, { kind })}
                onMerge={() => void merge(segment)}
              />
            </Fragment>
          ))}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
