import { useCallback, useEffect, useState } from "react"

import { toast } from "sonner"

import { api } from "./http"
import type { Chapter, Note, Page, Segment, SegmentPatch } from "./api"

const OP_LABEL: Record<string, string> = {
  updateSegment: "단락 수정",
  splitSegment: "분할",
  mergeWithNext: "병합",
  setNoteAnchor: "미주 연결",
}

/** Book-level state: chapters, the selected chapter's segments, and page images. */
export function useBook() {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [chapterId, setChapterId] = useState<number | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [unanchoredNotes, setUnanchoredNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)

  const refreshChapters = useCallback(
    () => api.listChapters().then(setChapters).catch((e: Error) => setError(e.message)),
    [],
  )
  const refreshSegments = useCallback(
    (id: number) => api.listSegments(id).then(setSegments).catch((e: Error) => setError(e.message)),
    [],
  )

  const refreshNotes = useCallback(
    () => api.listUnanchoredNotes().then(setUnanchoredNotes).catch((e: Error) => setError(e.message)),
    [],
  )

  useEffect(() => {
    Promise.all([api.listChapters(), api.listPages(), api.listUnanchoredNotes()])
      .then(([cs, ps, ns]) => {
        setChapters(cs)
        setPages(ps)
        setUnanchoredNotes(ns)
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

  const anchorNote = useCallback(
    async (noteId: number, segmentId: number) => {
      try {
        await api.anchorNote(noteId, segmentId)
        await refreshNotes()
        toast.success("미주를 연결했습니다")
      } catch (e) {
        toast.error("연결 실패", { description: (e as Error).message })
      }
    },
    [refreshNotes],
  )

  /** Undo/redo may touch any table, so reload everything the screen shows. */
  const reloadAll = useCallback(async () => {
    await Promise.all([refreshChapters(), refreshNotes(), chapterId !== null ? refreshSegments(chapterId) : null])
  }, [chapterId, refreshChapters, refreshNotes, refreshSegments])

  const undo = useCallback(async () => {
    try {
      const op = await api.undo()
      if (!op) return
      await reloadAll()
      toast("되돌렸습니다", { description: OP_LABEL[op.name] ?? op.name })
    } catch (e) {
      toast.error("되돌리기 실패", { description: (e as Error).message })
    }
  }, [reloadAll])

  const redo = useCallback(async () => {
    try {
      const op = await api.redo()
      if (!op) return
      await reloadAll()
      toast("다시 실행했습니다", { description: OP_LABEL[op.name] ?? op.name })
    } catch (e) {
      toast.error("다시 실행 실패", { description: (e as Error).message })
    }
  }, [reloadAll])

  const chapter = chapters.find((c) => c.id === chapterId) ?? null

  return {
    chapters, pages, chapter, chapterId, setChapterId, segments, error,
    refreshChapters, refreshSegments, updateSegment, splitSegment, mergeWithNext,
    unanchoredNotes, anchorNote, undo, redo,
  }
}
