import { useCallback, useEffect, useRef, useState } from "react"

import { toast } from "sonner"

import { api } from "./http"
import type { Chapter, Note, Page, Segment, SegmentPatch } from "./api"

export const OP_LABEL: Record<string, string> = {
  updateSegment: "단락 수정",
  splitSegment: "분할",
  mergeWithNext: "병합",
  setNoteAnchor: "미주 연결",
}

export type SaveState = "idle" | "saving" | "saved" | "error"

/** Book-level state: chapters, the selected chapter's segments, and page images. */
export function useBook() {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [chapterId, setChapterId] = useState<number | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [unanchoredNotes, setUnanchoredNotes] = useState<Note[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const pending = useRef(0)

  /** Every write goes through here: one place owns the save indicator and the error toast. */
  const mutate = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    pending.current += 1
    setSaveState("saving")
    try {
      const out = await fn()
      if (--pending.current === 0) setSaveState("saved")
      return out
    } catch (e) {
      --pending.current
      setSaveState("error")
      toast.error(`${label} 실패`, { description: (e as Error).message })
      return null
    }
  }, [])

  // warn before closing the window while a write is in flight
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (pending.current > 0) e.preventDefault()
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [])

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
    (id: number, patch: SegmentPatch) =>
      mutate("저장", async () => {
        const updated = await api.updateSegment(id, patch)
        setSegments((list) => list.map((s) => (s.id === id ? updated : s)))
        void refreshChapters()
        return updated
      }),
    [mutate, refreshChapters],
  )

  /** Split/merge renumber the chapter, so reload the whole list afterwards. Returns the surviving head id. */
  const splitSegment = useCallback(
    (id: number, offset: number) =>
      mutate("분할", async () => {
        const [head] = await api.splitSegment(id, offset)
        if (chapterId !== null) await refreshSegments(chapterId)
        void refreshChapters()
        return head.id
      }),
    [mutate, chapterId, refreshSegments, refreshChapters],
  )
  const mergeWithNext = useCallback(
    (id: number) =>
      mutate("병합", async () => {
        const merged = await api.mergeWithNext(id)
        if (chapterId !== null) await refreshSegments(chapterId)
        void refreshChapters()
        return merged.id
      }),
    [mutate, chapterId, refreshSegments, refreshChapters],
  )

  const anchorNote = useCallback(
    (noteId: number, segmentId: number) =>
      mutate("미주 연결", async () => {
        await api.anchorNote(noteId, segmentId)
        await refreshNotes()
        toast.success("미주를 연결했습니다")
      }),
    [mutate, refreshNotes],
  )

  /** Undo/redo may touch any table, so reload everything the screen shows. */
  const reloadAll = useCallback(async () => {
    await Promise.all([refreshChapters(), refreshNotes(), chapterId !== null ? refreshSegments(chapterId) : null])
  }, [chapterId, refreshChapters, refreshNotes, refreshSegments])

  const undo = useCallback(
    () =>
      mutate("되돌리기", async () => {
        const op = await api.undo()
        if (!op) return
        await reloadAll()
        toast("되돌렸습니다", { description: OP_LABEL[op.name] ?? op.name })
      }),
    [mutate, reloadAll],
  )

  const redo = useCallback(
    () =>
      mutate("다시 실행", async () => {
        const op = await api.redo()
        if (!op) return
        await reloadAll()
        toast("다시 실행했습니다", { description: OP_LABEL[op.name] ?? op.name })
      }),
    [mutate, reloadAll],
  )

  const chapter = chapters.find((c) => c.id === chapterId) ?? null

  return {
    chapters, pages, chapter, chapterId, setChapterId, segments, error,
    refreshChapters, refreshSegments, updateSegment, splitSegment, mergeWithNext,
    unanchoredNotes, anchorNote, undo, redo, saveState,
  }
}
