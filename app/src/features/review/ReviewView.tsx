import { useCallback, useEffect, useRef, useState } from "react"

import { PageViewer } from "./PageViewer"
import { SegmentList } from "./SegmentList"
import type { Page, Segment, SegmentPatch } from "@/data/api"

interface Props {
  pages: Page[]
  segments: Segment[]
  onPatch: (id: number, patch: SegmentPatch) => Promise<unknown>
  onSplit: (id: number, offset: number) => Promise<unknown>
  onMerge: (id: number) => Promise<unknown>
  /** The page viewer moved to a page outside this chapter: switch to the chapter that owns it (if any). */
  onPageOutsideChapter: (pageNo: number) => void
}

/** Review mode: page image on the left, the chapter's segments on the right, kept on the same page.
 *  Selection, editing and the per-segment actions are exposed as commands so buttons and keys share them. */
export function useReview({ pages, segments, onPatch, onSplit, onMerge, onPageOutsideChapter }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [pageNo, setPageNo] = useState<number | null>(null)
  /** Page to land on once the next chapter's segments arrive (set when paging across a chapter boundary). */
  const [pendingPage, setPendingPage] = useState<number | null>(null)

  // A different chapter arrived (or a page is pending): land on the pending page's first segment,
  // else the chapter's first segment. Reloads of the same chapter (split/merge/undo) keep the selection;
  // an empty selection on a blank page is not a chapter change.
  const shownChapter = useRef<number | null>(null)
  useEffect(() => {
    const first = segments[0]
    if (!first) return
    const sameChapter = first.chapterId === shownChapter.current
    if (sameChapter && pendingPage === null) {
      if (selectedId !== null && !segments.some((s) => s.id === selectedId)) setSelectedId(null) // selection vanished (merge)
      return
    }
    shownChapter.current = first.chapterId
    const target = pendingPage === null ? first : segments.find((s) => s.pageStart <= pendingPage && pendingPage <= s.pageEnd) ?? null
    setSelectedId(target?.id ?? null)
    setPageNo(pendingPage ?? first.pageStart)
    setPendingPage(null)
    setEditingId(null)
  }, [segments, selectedId, pendingPage])

  const selected = segments.find((s) => s.id === selectedId) ?? null

  const selectSegment = useCallback((s: Segment) => {
    setSelectedId(s.id)
    setPageNo(s.pageStart)
  }, [])
  const selectByDelta = useCallback(
    (delta: number) => {
      const i = segments.findIndex((s) => s.id === selectedId)
      const next = segments[Math.min(segments.length - 1, Math.max(0, (i === -1 ? 0 : i) + delta))]
      if (next) selectSegment(next)
    },
    [segments, selectedId, selectSegment],
  )
  const changePage = (no: number) => {
    setPageNo(no)
    const onPage = segments.find((s) => s.pageStart <= no && no <= s.pageEnd)
    if (onPage) { setSelectedId(onPage.id); return }
    const lo = segments[0]?.pageStart ?? Infinity
    const hi = segments[segments.length - 1]?.pageEnd ?? -Infinity
    if (no < lo || no > hi) {
      // outside this chapter: ask for the owning chapter and land on `no` when it loads
      setPendingPage(no)
      onPageOutsideChapter(no)
    } else {
      setSelectedId(null) // a page inside the chapter with no segments (blank or plates)
    }
  }

  /** Move the selection and keep editing there (Tab / Shift-Tab from inside the editor). */
  const stepEditing = useCallback(
    (delta: 1 | -1) => {
      const i = segments.findIndex((s) => s.id === selectedId)
      const next = segments[(i === -1 ? 0 : i) + delta]
      if (!next) { setEditingId(null); return }
      selectSegment(next)
      setEditingId(next.id)
    },
    [segments, selectedId, selectSegment],
  )

  const commands = {
    selectNext: () => selectByDelta(1),
    selectPrev: () => selectByDelta(-1),
    toggleVerified: () => selected && void onPatch(selected.id, { verified: !selected.verified }),
    startEdit: () => selected && setEditingId(selected.id),
    cancelEdit: () => setEditingId(null),
  }

  const highlight = selected?.boxes.find((b) => b.pageNo === pageNo) ?? null

  return {
    left: <PageViewer pages={pages} pageNo={pageNo} onPageChange={changePage} highlight={highlight} />,
    right: (
      <SegmentList
        segments={segments}
        pageNo={pageNo}
        selectedId={selectedId}
        editingId={editingId}
        onSelect={selectSegment}
        onEditingChange={setEditingId}
        onPatch={onPatch}
        onSplit={onSplit}
        onMerge={onMerge}
        onStep={stepEditing}
      />
    ),
    selected,
    editing: editingId !== null,
    commands,
  }
}
