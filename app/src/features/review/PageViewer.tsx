import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { pageImageUrl } from "@/data/http"
import type { Page } from "@/data/api"

interface Props {
  pages: Page[]
  pageNo: number | null
  onPageChange: (pageNo: number) => void
}

/** Scanned page of the printed book. Navigation is by printed page number. */
export function PageViewer({ pages, pageNo, onPageChange }: Props) {
  const page = pages.find((p) => p.pageNo === pageNo) ?? null
  const first = pages[0]?.pageNo ?? 1
  const last = pages[pages.length - 1]?.pageNo ?? 1

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-center gap-1 border-b text-xs">
        <Button variant="ghost" size="icon-sm" disabled={pageNo === null || pageNo <= first}
          onClick={() => pageNo !== null && onPageChange(pageNo - 1)} aria-label="이전 페이지">
          <IconChevronLeft />
        </Button>
        <span className="w-24 text-center tabular-nums">
          {pageNo === null ? "—" : `p. ${pageNo}`}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={pageNo === null || pageNo >= last}
          onClick={() => pageNo !== null && onPageChange(pageNo + 1)} aria-label="다음 페이지">
          <IconChevronRight />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 bg-muted/40">
        {page ? (
          <img src={pageImageUrl(page.imageUrl)} alt={`원서 ${page.pageNo}쪽`} className="mx-auto block max-w-full" />
        ) : (
          <div className="p-8 text-center text-xs text-muted-foreground">페이지 없음</div>
        )}
      </ScrollArea>
    </div>
  )
}
