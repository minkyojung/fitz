import { useCallback, useEffect, useState } from "react"

import { PageViewer } from "./PageViewer"
import { SegmentList } from "./SegmentList"
import type { Page, Segment, SegmentPatch } from "@/data/api"

interface Props {
  pages: Page[]
  segments: Segment[]
  onPatch: (id: number, patch: SegmentPatch) => Promise<unknown>
  onSplit: (id: number, offset: number) => Promise<unknown>
  onMerge: (id: number) => Promise<unknown>
}

/** Review mode: page image on the left, the chapter's segments on the right, kept on the same page.
 *  Selection, editing and the per-segment actions are exposed as commands so buttons and keys share them. */
export function useReview({ pages, segments, onPatch, onSplit, onMerge }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [pageNo, setPageNo] = useState<number | null>(null)

  // new chapter → start at its first segment
  useEffect(() => {
    const first = segments[0]
    if (!first) return
    if (!segments.some((s) => s.id === selectedId)) {
      setSelectedId(first.id)
      setPageNo(first.pageStart)
      setEditingId(null)
    }
  }, [segments, selectedId])

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
    if (onPage) setSelectedId(onPage.id)
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
