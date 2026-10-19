import { useCallback, useMemo, useRef, useState } from "react"
import { IconArrowBackUp, IconArrowForwardUp } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { cn } from "cn"
import { Kbd } from "@/components/ui/kbd"

import { AppShell, type Mode } from "@/layout/AppShell"
import { ChapterList, ChapterMenu } from "@/features/review/ChapterList"
import { FindInput, FindResults } from "@/features/review/Find"
import { ExportView } from "@/features/export/ExportView"
import { GlossaryPage } from "@/features/review/GlossaryPage"
import { SessionPage } from "@/features/session/SessionPage"
import { useSession } from "@/features/session/useSession"
import { ClaudeTab } from "@/features/agent/ClaudeTab"
import { DraftContext } from "@/features/review/DraftContext"
import { SpellContext } from "@/features/review/SpellContext"
import { FloatingToolbar } from "@/features/selection/FloatingToolbar"
import { SelectionContext } from "@/features/selection/SelectionContext"
import type { TextSelection } from "@/lib/selection"
import { AnnotationsContext, type Selected } from "@/features/notes/AnnotationsContext"
import { NotesButton } from "@/features/notes/NotesButton"
import { SuggestionsContext } from "@/features/suggestions/SuggestionsContext"
import type { Chapter, TaskName } from "@/data/api"
import { findSuspects } from "@/lib/spell"
import { useReview } from "@/features/review/ReviewView"
import { useTranslate } from "@/features/translate/TranslateView"
import { Toggle } from "@/components/ui/toggle"
import { formatSheets, sheets } from "@/lib/manuscript"
import { useBook, type SaveState } from "@/data/useBook"
import { useClaude } from "@/data/useClaude"
import type { Pointed } from "@/lib/conversation"
import { useKeymap } from "@/lib/useKeymap"
import { chapterForPage } from "@/lib/pages"
import { KEYMAP, chordLabel } from "@/lib/keymap"

const HINTS: { command: keyof typeof KEYMAP; label: string }[] = [
  { command: "selectNext", label: "Move" },
  { command: "toggleVerified", label: "Verify" },
  { command: "startEdit", label: "Edit" },
  { command: "undo", label: "Undo" },
]

const SAVE_LABEL: Record<SaveState, { text: string; className: string }> = {
  idle: { text: "", className: "" },
  saving: { text: "Saving…", className: "text-muted-foreground" },
  saved: { text: "Saved", className: "text-muted-foreground" },
  error: { text: "Save failed", className: "text-destructive font-medium" },
}

export function App() {
  const [mode, setMode] = useState<Mode>("review")
  const [claudeOpen, setClaudeOpen] = useState(true)
  const [findQuery, setFindQuery] = useState("")
  const [findFocusToken, setFindFocusToken] = useState(0)
  const book = useBook()
  const review = useReview({
    pages: book.pages, segments: book.segments,
    onPatch: book.updateSegment, onSplit: book.splitSegment, onMerge: book.mergeWithNext,
    onPageOutsideChapter: (pageNo) => {
      const target = chapterForPage(book.chapters, pageNo)
      if (target !== null && target !== book.chapterId) book.setChapterId(target)
    },
    onSelectChapter: book.setChapterId,
    onAddCaption: book.addCaption,
  })
  const [focusMode, setFocusMode] = useState(false)
  const [annSelected, setAnnSelected] = useState<Selected>(null)
  const [textSelection, setTextSelection] = useState<TextSelection | null>(null)
  // the selection as of the last event, for a key pressed before the screen has caught up with it (⌘L)
  const latestSelection = useRef<TextSelection | null>(null)
  const publishSelection = useCallback((sel: TextSelection | null) => { latestSelection.current = sel; setTextSelection(sel) }, [])
  const selectionState = useMemo(() => ({ selection: textSelection, publish: publishSelection }), [textSelection, publishSelection])
  const blockText = useCallback(
    (segmentId: number, side: "source" | "target") => { const sg = book.segments.find((x) => x.id === segmentId); return side === "source" ? sg?.sourceText ?? "" : sg?.targetText ?? "" },
    [book.segments],
  )
  // the scan is folded away while translating (the source sits right beside the translation); ⌘I or the toggle brings it back
  const [scanShown, setScanShown] = useState<Record<Mode, boolean>>({ review: true, translate: false, export: false, glossary: false, session: false })
  const toggleScan = () => setScanShown((m) => ({ ...m, [mode]: !m[mode] }))
  const translate = useTranslate({ segments: book.segments, onPatch: book.updateSegment, focusMode, notes: book.annotations.notes, onSelectChapter: book.setChapterId })
  const translating = mode === "translate"
  const exporting = mode === "export"
  // Export, the glossary and Session are pages of the whole book, in the panels' place: no chapter, no paragraph to act on
  const wholeBook = exporting || mode === "glossary" || mode === "session"
  const session = useSession()
  const commands = wholeBook ? {} : translating ? translate.commands : review.commands
  const panelSelected = translating ? translate.selected : review.selected
  const annotationState = useMemo(
    () => ({ annotations: book.annotations, selected: annSelected, select: setAnnSelected, actions: book.annotate, markers: translate.markers }),
    [book.annotations, annSelected, book.annotate, translate.markers],
  )
  // Claude's suggestions: the review's while translating, the OCR hunt's while reviewing the source. Selecting one in the
  // text opens its card in Claude's panel (opening the panel if it is closed).
  const task: TaskName = translating ? "review" : "typos"
  const [suggestionSelected, setSuggestionSelected] = useState<number | null>(null)
  const selectSuggestion = useCallback((id: number | null) => { setSuggestionSelected(id); if (id !== null) setClaudeOpen(true) }, [])
  const claude = useClaude()
  const [claudeFocusToken, setClaudeFocusToken] = useState(0)
  /** Ask Claude (the toolbar, ⌘L): the panel opens, the selected words wait in Claude's box, which takes the cursor. */
  const askClaude = useCallback((pointed: Pointed | null) => {
    if (pointed) claude.point(pointed)
    setClaudeOpen(true)
    setClaudeFocusToken((n) => n + 1)
  }, [claude])
  const suggestionState = useMemo(
    () => ({ suggestions: book.suggestions.filter((s) => s.task === task), selected: suggestionSelected, select: selectSuggestion }),
    [book.suggestions, task, suggestionSelected, selectSuggestion],
  )
  const chapterSheets = useMemo(() => sheets(book.segments.map((s) => s.targetText).join("\n")), [book.segments])
  // the whole book's progress in each stage, for the stage's badge in the sidebar
  const stageProgress = useMemo(() => {
    const total = book.chapters.reduce((n, c) => n + c.segmentCount, 0)
    const pct = (count: (c: Chapter) => number) => (total ? Math.round((book.chapters.reduce((n, c) => n + count(c), 0) / total) * 100) : 0)
    return { review: pct((c) => c.verifiedCount), translate: pct((c) => c.confirmedCount) }
  }, [book.chapters])
  const { speller, userWords } = book.spell
  const suspectTotal = useMemo(
    () => (speller ? book.segments.reduce((n, s) => n + findSuspects(s.sourceText, speller.correct, userWords).length, 0) : 0),
    [speller, userWords, book.segments],
  )
  const openFind = () => setFindFocusToken((n) => n + 1)
  // a paragraph from Find or the glossary opens in the stage you are in; from a page of the whole book, in Review (both
  // find it in the source)
  const jumpTo = (segmentId: number, chapterId: number) => {
    if (translating) return translate.jumpTo(segmentId, chapterId)
    if (wholeBook) setMode("review")
    review.jumpTo(segmentId, chapterId)
  }
  // from Session, a paragraph opens in Translate, beside its translation; Discuss with Claude puts the words in Claude's box there
  const openInTranslate = (segmentId: number, chapterId: number) => { setMode("translate"); translate.jumpTo(segmentId, chapterId) }
  const discussInTranslate = (pointed: Pointed, chapterId: number) => { openInTranslate(pointed.segmentId, chapterId); askClaude(pointed) }
  // ⌘L: the words selected (in the text or the open editor) go to Claude; with none, Claude's box takes the cursor
  const askAboutSelection = () => {
    const sel = latestSelection.current
    askClaude(sel ? { segmentId: sel.segmentId, side: sel.side, quote: sel.text } : null)
    if (sel?.origin === "dom") window.getSelection()?.removeAllRanges()
    publishSelection(null)
  }
  useKeymap(useMemo(() => ({ ...commands, undo: book.undo, redo: book.redo, find: openFind, toggleScan, askClaude: askAboutSelection }), [commands, book.undo, book.redo, askClaude])) // eslint-disable-line react-hooks/exhaustive-deps

  if (book.error) return <div className="p-8 text-destructive">API connection failed: {book.error}</div>
  const place = exporting ? "Export" : mode === "glossary" ? "Glossary" : mode === "session" ? "Session" : book.chapter?.title ?? "—"

  return (
    <DraftContext value={book.drafts}>
    <SpellContext value={book.spell}>
    <AnnotationsContext value={annotationState}>
    <SuggestionsContext value={suggestionState}>
    <SelectionContext value={selectionState}>
    <FloatingToolbar blockText={blockText} onAsk={askClaude} />
    <AppShell
      mode={mode}
      onModeChange={setMode}
      book={book.book}
      find={<FindInput query={findQuery} onQuery={setFindQuery} focusToken={findFocusToken} />}
      stageProgress={stageProgress}
      pendingTerms={book.spell.glossary.filter((t) => !t.translation).length}
      sessionLeft={session.left}
      leftCollapsed={!scanShown[mode]}
      // what Find found takes the chapters' place; a page of the whole book has none (Export picks its own)
      sidebar={findQuery ? (
        <FindResults query={findQuery} refreshKey={book.segments} selectedId={panelSelected?.id ?? null} onJump={jumpTo} onReplaceAll={book.replaceAll} />
      ) : wholeBook ? null : <ChapterList chapters={book.chapters} selectedId={book.chapterId} onSelect={book.setChapterId} progress={translating ? "confirmed" : "verified"} />}
      crumb={wholeBook ? null : <ChapterMenu chapters={book.chapters} selectedId={book.chapterId} onSelect={book.setChapterId} progress={translating ? "confirmed" : "verified"} />}
      main={exporting ? <ExportView chapters={book.chapters} /> : mode === "glossary" ? <GlossaryPage onJump={jumpTo} />
        : mode === "session" ? <SessionPage day={session.day} error={session.error} chapters={book.chapters} reload={session.reload} onJump={openInTranslate} onDiscuss={discussInTranslate} />
        : undefined}
      left={review.left}
      right={translating ? translate.view : review.right}
      panel={
        <ClaudeTab
          claude={claude} focusToken={claudeFocusToken} segments={book.segments}
          suggest={{
            task, run: book.chapterId !== null ? book.suggest.runs[`${task}:${book.chapterId}`] : undefined,
            onRun: () => { if (book.chapterId !== null) book.suggest.run(task, book.chapterId) },
            onDecide: book.suggest.decide,
          }}
        />
      }
      claudeOpen={claudeOpen}
      onClaudeOpenChange={setClaudeOpen}
      claudeWaiting={
        claude.view.asks.length ? "Claude is waiting for your answer"
          : suggestionState.suggestions.length ? `${suggestionState.suggestions.length} open suggestion${suggestionState.suggestions.length > 1 ? "s" : ""}` : null
      }
      status={
        <>
          {/* a long chapter title gives way first: the status bar is full at 1280px */}
          <span className="max-w-48 min-w-0 truncate" title={place}>{place}</span>
          {wholeBook ? null : translating ? (
            <>
              <span>Confirmed {book.chapter?.confirmedCount ?? 0} / {book.chapter?.segmentCount ?? 0}</span>
              <span data-sheets>{formatSheets(chapterSheets)}</span>
              <Toggle size="sm" variant="outline" className="text-xs" pressed={focusMode} onPressedChange={setFocusMode} aria-label="Focus mode">Focus</Toggle>
              <Toggle size="sm" variant="outline" className="text-xs" pressed={scanShown[mode]} onPressedChange={toggleScan} aria-label="Show scan">Scan</Toggle>
            </>
          ) : (
            <span>
              Verified {book.chapter?.verifiedCount ?? 0} / {book.chapter?.segmentCount ?? 0}
            </span>
          )}
          {!wholeBook && <NotesButton segments={book.segments} unlinked={book.unanchoredNotes} onAnchor={book.anchorNote} translating={translating} />}
          {mode === "review" && <span data-suspect-total>Suspects {suspectTotal}</span>}
          {/* the keys' reminder, where there is room for it */}
          <span className={cn("hidden items-center gap-3 min-[1440px]:flex", wholeBook && "min-[1440px]:hidden")}>
            {HINTS.map((h) => (
              <span key={h.command} className="flex items-center gap-1">
                <Kbd>{chordLabel(KEYMAP[h.command][0])}</Kbd>
                {h.command === "selectNext" && <Kbd>{chordLabel(KEYMAP.selectPrev[0])}</Kbd>}
                <span>{h.label}</span>
              </span>
            ))}
          </span>
          <span className={`ml-auto ${SAVE_LABEL[book.saveState].className}`} role="status" aria-live="polite">
            {SAVE_LABEL[book.saveState].text}
          </span>
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Undo" onClick={() => void book.undo()}>
              <IconArrowBackUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Redo" onClick={() => void book.redo()}>
              <IconArrowForwardUp />
            </Button>
          </span>
        </>
      }
    />
    </SelectionContext>
    </SuggestionsContext>
    </AnnotationsContext>
    </SpellContext>
    </DraftContext>
  )
}

export default App
