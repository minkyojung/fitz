import { useCallback, useEffect, useState } from "react"

import { api } from "./http"
import type { Chapter, Page, Segment } from "./api"

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

  const chapter = chapters.find((c) => c.id === chapterId) ?? null

  return { chapters, pages, chapter, chapterId, setChapterId, segments, error, refreshChapters, refreshSegments }
}
