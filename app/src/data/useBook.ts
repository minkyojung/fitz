import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { toast } from "sonner"

import { api } from "./http"
import type { Annotations, Book, Chapter, GlossaryTerm, Note, Page, Segment, SegmentPatch, Suggestion, SuggestionDecision, TaskName, TaskRun, TextAnchor } from "./api"
import { createDraftStore } from "@/lib/draftStore"
import { buildCorpus, type Corpus } from "@/lib/corpus"
import { loadEnglishSpeller, type Speller } from "@/lib/spell"

export const OP_LABEL: Record<string, string> = {
  updateSegment: "Edit paragraph",
  splitSegment: "Split",
  mergeWithNext: "Merge",
  setNoteAnchor: "Link note",
  insertSegment: "Add paragraph",
  deleteSegment: "Delete paragraph",
  setDocs: "Replace all",
  addGlossaryWord: "Add to dictionary",
  removeGlossaryWord: "Remove from dictionary",
  setGlossaryTerm: "Glossary",
  addComment: "Comment",
  setComment: "Comment",
  deleteComment: "Delete comment",
  restoreComments: "Restore comment",
  addNote: "Translator's note",
  setNote: "Note",
  deleteNote: "Delete note",
  decideSuggestion: "Claude's suggestion",
}
const DECISION_LABEL: Record<SuggestionDecision, string> = { accept: "Accept", dismiss: "Dismiss", comment: "Keep as comment" }

export const CAPTION_PLACEHOLDER = "Caption"

// ⌘Z and ⌘⇧Z take back only the translator's own changes (docs/agent.md §18). One that Claude changed the same thing
// after is not taken back: the server says so (409), and that is news, not a failure.
function refused(title: string, e: unknown): null {
  if ((e as { status?: number }).status !== 409) throw e
  toast.warning(title, { description: `${(e as Error).message}. To take yours back, first undo Claude's change in the Claude tab.` })
  return null
}

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
  // spelling: dictionary engine, the book's own word statistics, and words the person accepted
  const [speller, setSpeller] = useState<Speller | null>(null)
  const [corpus, setCorpus] = useState<Corpus>(() => buildCorpus([]))
  const [userWords, setUserWords] = useState<ReadonlySet<string>>(new Set())
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([])
  const [annotations, setAnnotations] = useState<Annotations>({ comments: [], notes: [] })
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  /** Claude's runs on chapters, by task and chapter ("review:3"). */
  const [runs, setRuns] = useState<Record<string, TaskRun>>({})
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
  const refreshAnnotations = useCallback(
    (id: number) => api.listAnnotations(id).then(setAnnotations).catch(() => undefined),
    [],
  )
  const refreshSuggestions = useCallback(
    (id: number) => api.listSuggestions(id).then(setSuggestions).catch(() => undefined),
    [],
  )

  const refreshCorpus = useCallback(
    () => api.listSourceTexts().then((rows) => setCorpus(buildCorpus(rows.map((r) => r.text)))).catch(() => undefined),
    [],
  )
  /** The glossary doubles as the dictionary: every term is a known word. */
  const refreshWords = useCallback(
    (bookId: number) =>
      api.listGlossary(bookId).then((g) => { setGlossary(g); setUserWords(new Set(g.map((t) => t.term))) }).catch(() => undefined),
    [],
  )
  useEffect(() => { void loadEnglishSpeller().then(setSpeller) }, [])

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
        void refreshCorpus()
        void refreshWords(b.id)
      })
      .catch((e: Error) => setError(e.message))
  }, [refreshCorpus, refreshWords])  // both stable: this still runs once, on load

  useEffect(() => {
    if (chapterId !== null) { void refreshSegments(chapterId); void refreshAnnotations(chapterId); void refreshSuggestions(chapterId) }
  }, [chapterId, refreshSegments, refreshAnnotations, refreshSuggestions])

  // the segments on screen, for a save to name the version it was based on
  const shown = useRef(segments)
  useEffect(() => { shown.current = segments }, [segments])

  /** Persist a change, then replace the row in place and refresh chapter counts. A change of text or status names the
   *  version it was based on — the editors pass the one they started editing from, anything else the one on screen —
   *  so it never overwrites what another writer (the agent, another window) did meanwhile: the server refuses (409)
   *  and writes nothing. Flags (verified, kind) name none: the server keeps every other field as stored. */
  const updateSegment = useCallback(
    (id: number, patch: SegmentPatch) =>
      mutate("Save", async () => {
        const current = shown.current.find((s) => s.id === id)
        const content = patch.sourceDoc !== undefined || patch.sourceText !== undefined || patch.targetDoc !== undefined || patch.status !== undefined
        const expectVersion = patch.expectVersion ?? (content ? current?.version : undefined)
        try {
          const updated = await api.updateSegment(id, { ...patch, expectVersion })
          setSegments((list) => list.map((s) => (s.id === id ? updated : s)))
          void refreshChapters()
          if (patch.sourceDoc !== undefined || patch.sourceText !== undefined) void refreshCorpus()
          return updated
        } catch (e) {
          if ((e as { status?: number }).status !== 409) throw e
          if (current) void refreshSegments(current.chapterId)  // show what is there now
          throw new Error("This paragraph changed meanwhile (the agent or another window wrote it), so nothing was saved. It now shows the current text; what you were writing is kept as an unsaved draft.", { cause: e })
        }
      }),
    [mutate, refreshChapters, refreshCorpus, refreshSegments],
  )

  /** Comments and notes: every action is a logged command; the chapter's annotations reload afterwards. */
  const annotate = useMemo(() => {
    const after = async <T,>(label: string, fn: () => Promise<T>) =>
      mutate(label, async () => { const r = await fn(); if (chapterId !== null) await refreshAnnotations(chapterId); return r })
    return {
      addComment: (segmentId: number, side: "source" | "target", anchor: TextAnchor | null, body: string, parentId: number | null = null) =>
        after("Comment", () => api.addComment({ segmentId, side, anchor, body, parentId })),
      setComment: (id: number, patch: { body?: string; resolved?: boolean }) => after("Comment", () => api.setComment({ id, ...patch })),
      deleteComment: (id: number) => after("Delete comment", () => api.deleteComment(id)),
      addNote: (segmentId: number, anchor: TextAnchor | null, body: string) => after("Translator's note", () => api.addNote({ segmentId, anchor, body })),
      setNote: (id: number, patch: { body?: string; targetAnchor?: TextAnchor | null }) => after("Note", () => api.setNote({ id, ...patch })),
      deleteNote: (id: number) => after("Delete note", () => api.deleteNote(id)),
    }
  }, [mutate, chapterId, refreshAnnotations])

  /** Set a term's agreed translation (creates the entry if needed). Undoable. */
  const setTerm = useCallback(
    (input: { term: string; translation: string; aliases: string; kind: GlossaryTerm["kind"] }) =>
      mutate("Glossary", async () => {
        if (!book) return null
        const r = await api.setGlossaryTerm({ bookId: book.id, ...input })
        await refreshWords(book.id)
        return r
      }),
    [mutate, book, refreshWords],
  )

  /** "This is a real word": add it to the book's dictionary (undoable). */
  const addWord = useCallback(
    (term: string) =>
      mutate("Add to dictionary", async () => {
        if (!book) return null
        const r = await api.addGlossaryWord(book.id, term)
        await refreshWords(book.id)
        return r
      }),
    [mutate, book, refreshWords],
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

  /** What the screen shows of the book, reloaded: chapters and their counts, the chapter's paragraphs, annotations and
   *  Claude's suggestions, unlinked notes, the glossary. */
  const reloadShown = useCallback(async () => {
    await Promise.all([refreshChapters(), refreshNotes(), ...(chapterId !== null ? [refreshSegments(chapterId), refreshAnnotations(chapterId), refreshSuggestions(chapterId)] : [])])
    if (book) await refreshWords(book.id)
  }, [chapterId, refreshChapters, refreshNotes, refreshSegments, refreshAnnotations, refreshSuggestions, refreshWords, book])
  /** Undo/redo may touch any table, source text included, so reload everything the screen shows and the corpus. */
  const reloadAll = useCallback(async () => { await Promise.all([reloadShown(), refreshCorpus()]) }, [reloadShown, refreshCorpus])

  // Another writer (the agent, another window, an undo there) changed the book: show it. Changes come in bursts, so
  // they are gathered for a moment. The spelling corpus is not reloaded: it moves only with the source text, which
  // the agent never writes, and this page's own source edits refresh it.
  const reloadShownLater = useRef(reloadShown)
  useEffect(() => { reloadShownLater.current = reloadShown }, [reloadShown])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = api.watchChanges(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void reloadShownLater.current(), 150)
    })
    return () => { clearTimeout(timer); stop() }
  }, [])

  const undo = useCallback(
    () =>
      mutate("Undo", async () => {
        const op = await api.undo().catch((e) => refused("Can't undo", e))
        if (!op) return
        await reloadAll()
        toast("Undone", { description: OP_LABEL[op.name] ?? op.name })
      }),
    [mutate, reloadAll],
  )

  const redo = useCallback(
    () =>
      mutate("Redo", async () => {
        const op = await api.redo().catch((e) => refused("Can't redo", e))
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

  /** Claude's suggestions (docs/agent.md §4): run a task on a chapter, and decide what it found. A decision is a logged
   *  command like any edit; what it changed is read again (an accepted OCR fix changes the source, so the corpus too).
   *  New suggestions arrive by themselves: the server announces them and the screen reloads. */
  const suggest = useMemo(() => ({
    runs,
    run: (task: TaskName, id: number) => {
      api.runTask(task, id, (run) => setRuns((r) => ({ ...r, [`${task}:${id}`]: run })))
    },
    decide: (s: Suggestion, decision: SuggestionDecision) =>
      mutate(DECISION_LABEL[decision], async () => {
        await api.decideSuggestion(s.id, decision)
        await Promise.all([reloadShown(), s.side === "source" && decision === "accept" ? refreshCorpus() : null])
      }),
  }), [runs, mutate, reloadShown, refreshCorpus])

  const chapter = chapters.find((c) => c.id === chapterId) ?? null
  // stable identity: every row subscribes to this, so it must only change when its parts do
  const spell = useMemo(() => ({ speller, corpus, userWords, addWord, glossary, setTerm }), [speller, corpus, userWords, addWord, glossary, setTerm])
  /** Crash insurance for in-progress edits; keyed by book so other databases never collide. */
  const drafts = useMemo(() => (book ? createDraftStore(localStorage, book.id) : null), [book])

  return {
    chapters, pages, chapter, chapterId, setChapterId, segments, error,
    refreshChapters, refreshSegments, updateSegment, splitSegment, mergeWithNext,
    unanchoredNotes, anchorNote, undo, redo, saveState, book, drafts, addCaption, replaceAll,
    spell, annotations, annotate, suggestions, suggest,
  }
}
