import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef } from "react"

import type { Box, Page } from "@shared/protocol.ts"

import { Button } from "@/components/ui/button"

/** One scanned page, with the chosen paragraph's box drawn on it, and a way to turn the pages. */
export function PageViewer({ pages, pageNo, boxes, onPage }: {
  /** In the order of the PDF. */
  pages: Page[]
  pageNo: number
  /** The chosen paragraph's boxes; those on this page are drawn. */
  boxes: Box[]
  onPage: (pageNo: number) => void
}) {
  const at = pages.findIndex((p) => p.pageNo === pageNo)
  const page = pages[at]
  const previous = pages[at - 1]
  const next = pages[at + 1]
  const box = boxes.find((b) => b.pageNo === pageNo)
  const boxRef = useRef<HTMLDivElement>(null)
  // the chosen paragraph is brought into view on the page (braces: scrollIntoView returns a promise in Chromium, and an
  // effect may return nothing but its cleanup)
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: "nearest" })
  }, [box])

  return (
    <div data-scan className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={!previous} onClick={() => previous && onPage(previous.pageNo)}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <span data-page-no={pageNo} className="min-w-14 text-center text-sm tabular-nums">p. {pageNo}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={!next} onClick={() => next && onPage(next.pageNo)}>
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-3">
        {page ? (
          <div className="relative mx-auto w-full max-w-3xl">
            <img src={page.image} alt={`Book page ${pageNo}`} className="block h-auto w-full bg-white shadow-sm" draggable={false} />
            {box && (
              <div
                ref={boxRef}
                data-box
                className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10"
                style={{ left: `${box.x0 * 100}%`, top: `${box.y0 * 100}%`, width: `${(box.x1 - box.x0) * 100}%`, height: `${(box.y1 - box.y0) * 100}%` }}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">There is no scan of p. {pageNo}.</p>
        )}
      </div>
    </div>
  )
}
