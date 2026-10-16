import { useEffect, useState } from "react"

import { PageViewer } from "./PageViewer"
import { SegmentList } from "./SegmentList"
import type { Page, Segment, SegmentPatch } from "@/data/api"

interface Props {
  pages: Page[]
  segments: Segment[]
  onPatch: (id: number, patch: SegmentPatch) => Promise<unknown>
}

/** Review mode: page image on the left, the chapter's segments on the right, kept on the same page. */
export function useReview({ pages, segments, onPatch }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [pageNo, setPageNo] = useState<number | null>(null)

  // new chapter → start at its first segment
  useEffect(() => {
    const first = segments[0]
    if (!first) return
    if (!segments.some((s) => s.id === selectedId)) {
      setSelectedId(first.id)
      setPageNo(first.pageStart)
    }
  }, [segments, selectedId])

  const selectSegment = (s: Segment) => {
    setSelectedId(s.id)
    setPageNo(s.pageStart)
  }
  const changePage = (no: number) => {
    setPageNo(no)
    const onPage = segments.find((s) => s.pageStart <= no && no <= s.pageEnd)
    if (onPage) setSelectedId(onPage.id)
  }

  return {
    left: <PageViewer pages={pages} pageNo={pageNo} onPageChange={changePage} />,
    right: <SegmentList segments={segments} selectedId={selectedId} onSelect={selectSegment} onPatch={onPatch} />,
    selected: segments.find((s) => s.id === selectedId) ?? null,
  }
}
