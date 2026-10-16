import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { toast } from "sonner"

import { api } from "./http"
import type { Book, Chapter, Note, Page, Segment, SegmentPatch } from "./api"
import { createDraftStore } from "@/lib/draftStore"

export const OP_LABEL: Record<string, string> = {
  updateSegment: "Edit paragraph",
  splitSegment: "Split",
  mergeWithNext: "Merge",
  setNoteAnchor: "Link note",
  insertSegment: "Add paragraph",
  deleteSegment: "Delete paragraph",
  setDocs: "Replace all",
}

export const CAPTION_PLACEHOLDER = "Caption"

export type SaveState = "idle" | "saving" | "saved" | "error"

/** Book-level state: chapters, the selected chapter's segments, and page images. */
export function useBook() {
  const [book, setBook] = useState<Book | null>(null)
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
      toast.error(`${label} failed`, { description: (e as Error).message })
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
    Promise.all([api.getBook(), api.listChapters(), api.listPages(), api.listUnanchoredNotes()])
      .then(([b, cs, ps, ns]) => {
        setBook(b)
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
      mutate("Save", async () => {
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
      mutate("Split", async () => {
        const [head] = await api.splitSegment(id, offset)
        if (chapterId !== null) await refreshSegments(chapterId)
        void refreshChapters()
        return head.id
      }),
    [mutate, chapterId, refreshSegments, refreshChapters],
  )
  const mergeWithNext = useCallback(
    (id: number) =>
      mutate("Merge", async () => {
        const merged = await api.mergeWithNext(id)
        if (chapterId !== null) await refreshSegments(chapterId)
        void refreshChapters()
        return merged.id
      }),
    [mutate, chapterId, refreshSegments, refreshChapters],
  )

  /** A caption placeholder for a page with photos: inserted after the last segment on or before that page. */
  const addCaption = useCallback(
    (pageNo: number) =>
      mutate("Add caption", async () => {
        if (chapterId === null) return null
        const before = segments.filter((s) => s.pageStart <= pageNo)
        const afterIdx = before.length ? before[before.length - 1].idx : -1
        const created = await api.insertSegment({ chapterId, afterIdx, kind: "caption", text: CAPTION_PLACEHOLDER, pageNo })
        await refreshSegments(chapterId)
        void refreshChapters()
        return created
      }),
    [mutate, chapterId, segments, refreshSegments, refreshChapters],
  )

  const anchorNote = useCallback(
    (noteId: number, segmentId: number) =>
      mutate("Link note", async () => {
        await api.anchorNote(noteId, segmentId)
        await refreshNotes()
        toast.success("Note linked")
      }),
    [mutate, refreshNotes],
  )

  /** Undo/redo may touch any table, so reload everything the screen shows. */
  const reloadAll = useCallback(async () => {
    await Promise.all([refreshChapters(), refreshNotes(), chapterId !== null ? refreshSegments(chapterId) : null])
  }, [chapterId, refreshChapters, refreshNotes, refreshSegments])

  const undo = useCallback(
    () =>
      mutate("Undo", async () => {
        const op = await api.undo()
        if (!op) return
        await reloadAll()
        toast("Undone", { description: OP_LABEL[op.name] ?? op.name })
      }),
    [mutate, reloadAll],
  )

  const redo = useCallback(
    () =>
      mutate("Redo", async () => {
        const op = await api.redo()
        if (!op) return
        await reloadAll()
        toast("Redone", { description: OP_LABEL[op.name] ?? op.name })
      }),
    [mutate, reloadAll],
  )

  const replaceAll = useCallback(
    (query: string, replacement: string) =>
      mutate("Replace all", async () => {
        const r = await api.replaceAll(query, replacement)
        if (r.segments) {
          await reloadAll()
          toast(`Replaced ${r.occurrences} matches in ${r.segments} paragraphs`, { description: "⌘Z undoes all of them at once" })
        }
        return r
      }),
    [mutate, reloadAll],
  )

  const chapter = chapters.find((c) => c.id === chapterId) ?? null
  /** Crash insurance for in-progress edits; keyed by book so other databases never collide. */
  const drafts = useMemo(() => (book ? createDraftStore(localStorage, book.id) : null), [book])

  return {
    chapters, pages, chapter, chapterId, setChapterId, segments, error,
    refreshChapters, refreshSegments, updateSegment, splitSegment, mergeWithNext,
    unanchoredNotes, anchorNote, undo, redo, saveState, book, drafts, addCaption, replaceAll,
  }
}
