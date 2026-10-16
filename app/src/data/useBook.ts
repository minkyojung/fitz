import { useCallback, useEffect, useState } from "react"

import { toast } from "sonner"

import { api } from "./http"
import type { Chapter, Page, Segment, SegmentPatch } from "./api"

/** Book-level state: chapters, the selected chapter's segments, and page images. */
export function useBook() {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [chapterId, setChapterId] = useState<number | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [error, setError] = useState<string | null>(null)

  const refreshChapters = useCallback(
    () => api.listChapters().then(setChapters).catch((e: Error) => setError(e.message)),
    [],
  )
  const refreshSegments = useCallback(
    (id: number) => api.listSegments(id).then(setSegments).catch((e: Error) => setError(e.message)),
    [],
  )

  useEffect(() => {
    Promise.all([api.listChapters(), api.listPages()])
      .then(([cs, ps]) => {
        setChapters(cs)
        setPages(ps)
        setChapterId((cur) => cur ?? cs[0]?.id ?? null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (chapterId !== null) void refreshSegments(chapterId)
  }, [chapterId, refreshSegments])

  /** Persist a change, then replace the row in place and refresh chapter counts. */
  const updateSegment = useCallback(
    async (id: number, patch: SegmentPatch) => {
      try {
        const updated = await api.updateSegment(id, patch)
        setSegments((list) => list.map((s) => (s.id === id ? updated : s)))
        void refreshChapters()
        return updated
      } catch (e) {
        toast.error("저장 실패", { description: (e as Error).message })
        return null
      }
    },
    [refreshChapters],
  )

  /** Split/merge renumber the chapter, so reload the whole list afterwards. Returns the surviving head id. */
  const splitSegment = useCallback(
    async (id: number, offset: number) => {
      try {
        const [head] = await api.splitSegment(id, offset)
        if (chapterId !== null) await refreshSegments(chapterId)
        void refreshChapters()
        return head.id
      } catch (e) {
        toast.error("분할 실패", { description: (e as Error).message })
        return null
      }
    },
    [chapterId, refreshSegments, refreshChapters],
  )
  const mergeWithNext = useCallback(
    async (id: number) => {
      try {
        const merged = await api.mergeWithNext(id)
        if (chapterId !== null) await refreshSegments(chapterId)
        void refreshChapters()
        return merged.id
      } catch (e) {
        toast.error("병합 실패", { description: (e as Error).message })
        return null
      }
    },
    [chapterId, refreshSegments, refreshChapters],
  )

  const chapter = chapters.find((c) => c.id === chapterId) ?? null

  return {
    chapters, pages, chapter, chapterId, setChapterId, segments, error,
    refreshChapters, refreshSegments, updateSegment, splitSegment, mergeWithNext,
  }
}
