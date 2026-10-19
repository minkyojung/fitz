import { useCallback, useMemo, useRef, useState } from "react"
import { IconArrowBackUp, IconArrowForwardUp } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { cn } from "cn"
import { Kbd } from "@/components/ui/kbd"

import { AppShell, type Mode } from "@/layout/AppShell"
import { ChapterList, ChapterMenu } from "@/features/review/ChapterList"
import { ExportView } from "@/features/export/ExportView"
import { ReviewPanel } from "@/features/review/ReviewPanel"
import { DraftContext } from "@/features/review/DraftContext"
import { SpellContext } from "@/features/review/SpellContext"
import { FloatingToolbar } from "@/features/selection/FloatingToolbar"
import { SelectionContext } from "@/features/selection/SelectionContext"
import type { TextSelection } from "@/lib/selection"
import { AnnotationsContext, type Selected } from "@/features/notes/AnnotationsContext"
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
  const [panelTab, setPanelTab] = useState("history")
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
  const [scanShown, setScanShown] = useState<Record<Mode, boolean>>({ review: true, translate: false, export: false })
  const toggleScan = () => setScanShown((m) => ({ ...m, [mode]: !m[mode] }))
  const translate = useTranslate({ segments: book.segments, onPatch: book.updateSegment, focusMode, notes: book.annotations.notes })
  const translating = mode === "translate"
  const exporting = mode === "export"
  const commands = exporting ? {} : translating ? translate.commands : review.commands
  const panelSelected = translating ? translate.selected : review.selected
  // a selected comment/note opens the Notes tab
  const selectAnnotation = useCallback((sel: Selected) => { setAnnSelected(sel); if (sel) setPanelTab("notes") }, [])
  const annotationState = useMemo(
    () => ({ annotations: book.annotations, selected: annSelected, select: selectAnnotation, actions: book.annotate, markers: translate.markers }),
    [book.annotations, annSelected, selectAnnotation, book.annotate, translate.markers],
  )
  // Claude's suggestions: the review's while translating, the OCR hunt's while reviewing the source. Selecting one in the
  // text opens its card, as selecting a comment opens Notes.
  const task: TaskName = translating ? "review" : "typos"
  const [suggestionSelected, setSuggestionSelected] = useState<number | null>(null)
  const selectSuggestion = useCallback((id: number | null) => { setSuggestionSelected(id); if (id !== null) setPanelTab("claude") }, [])
  const claude = useClaude()
  const [claudeFocusToken, setClaudeFocusToken] = useState(0)
  /** Ask Claude (the toolbar, ⌘L): the selected words wait in Claude's box, which takes the cursor. */
  const askClaude = useCallback((pointed: Pointed | null) => {
    if (pointed) claude.point(pointed)
    setPanelTab("claude")
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
  const openFind = () => { setPanelTab("find"); setFindFocusToken((n) => n + 1) }
  // ⌘L: the words selected (in the text or the open editor) go to Claude; with none, Claude's box takes the cursor
  const askAboutSelection = () => {
    const sel = latestSelection.current
    askClaude(sel ? { segmentId: sel.segmentId, side: sel.side, quote: sel.text } : null)
    if (sel?.origin === "dom") window.getSelection()?.removeAllRanges()
    publishSelection(null)
  }
  useKeymap(useMemo(() => ({ ...commands, undo: book.undo, redo: book.redo, find: openFind, toggleScan, askClaude: askAboutSelection }), [commands, book.undo, book.redo, askClaude])) // eslint-disable-line react-hooks/exhaustive-deps

  if (book.error) return <div className="p-8 text-destructive">API connection failed: {book.error}</div>

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
      stageProgress={stageProgress}
      leftCollapsed={!scanShown[mode]}
      // Export picks its chapters itself
      sidebar={exporting ? null : <ChapterList chapters={book.chapters} selectedId={book.chapterId} onSelect={book.setChapterId} progress={translating ? "confirmed" : "verified"} />}
      crumb={exporting ? null : <ChapterMenu chapters={book.chapters} selectedId={book.chapterId} onSelect={book.setChapterId} progress={translating ? "confirmed" : "verified"} />}
      main={exporting ? <ExportView chapters={book.chapters} /> : undefined}
      left={review.left}
      right={translating ? translate.view : review.right}
      panel={
        <ReviewPanel
          notes={book.unanchoredNotes} segments={book.segments} selected={panelSelected} onAnchor={book.anchorNote} markers={translate.markers}
          onJump={review.jumpTo} onReplaceAll={book.replaceAll}
          tab={panelTab} onTabChange={setPanelTab} findFocusToken={findFocusToken}
          suggest={{
            task, run: book.chapterId !== null ? book.suggest.runs[`${task}:${book.chapterId}`] : undefined,
            onRun: () => { if (book.chapterId !== null) book.suggest.run(task, book.chapterId) },
            onDecide: book.suggest.decide,
          }}
          claude={claude} claudeFocusToken={claudeFocusToken}
        />
      }
      status={
        <>
          <span>{exporting ? "Export" : book.chapter?.title ?? "—"}</span>
          {exporting ? null : translating ? (
            <>
              <span>Confirmed {book.chapter?.confirmedCount ?? 0} / {book.chapter?.segmentCount ?? 0}</span>
              <span data-sheets>{formatSheets(chapterSheets)}</span>
              <Toggle size="sm" variant="outline" pressed={focusMode} onPressedChange={setFocusMode} aria-label="Focus mode">Focus</Toggle>
              <Toggle size="sm" variant="outline" pressed={scanShown[mode]} onPressedChange={toggleScan} aria-label="Show scan">Scan</Toggle>
            </>
          ) : (
            <span>
              Verified {book.chapter?.verifiedCount ?? 0} / {book.chapter?.segmentCount ?? 0}
            </span>
          )}
          {!exporting && <span>Unlinked notes {book.unanchoredNotes.length}</span>}
          {!exporting && <span data-suspect-total>Suspects {suspectTotal}</span>}
          <span className={cn("hidden items-center gap-3 lg:flex", exporting && "lg:hidden")}>
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
            <Button variant="ghost" size="icon-xs" aria-label="Undo" onClick={() => void book.undo()}>
              <IconArrowBackUp />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Redo" onClick={() => void book.redo()}>
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
