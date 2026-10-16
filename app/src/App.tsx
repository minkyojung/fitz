import { useMemo, useState } from "react"
import { IconArrowBackUp, IconArrowForwardUp } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"

import { AppShell, type Mode } from "@/layout/AppShell"
import { ChapterList } from "@/features/review/ChapterList"
import { ReviewPanel } from "@/features/review/ReviewPanel"
import { DraftContext } from "@/features/review/DraftContext"
import { useReview } from "@/features/review/ReviewView"
import { useBook, type SaveState } from "@/data/useBook"
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
  const { commands } = review
  const openFind = () => { setPanelTab("find"); setFindFocusToken((n) => n + 1) }
  useKeymap(useMemo(() => ({ ...commands, undo: book.undo, redo: book.redo, find: openFind }), [commands, book.undo, book.redo]))

  if (book.error) return <div className="p-8 text-destructive">API connection failed: {book.error}</div>

  return (
    <DraftContext value={book.drafts}>
    <AppShell
      mode={mode}
      onModeChange={setMode}
      sidebar={<ChapterList chapters={book.chapters} selectedId={book.chapterId} onSelect={book.setChapterId} />}
      left={review.left}
      right={review.right}
      panel={
        <ReviewPanel
          notes={book.unanchoredNotes} segments={book.segments} selected={review.selected} onAnchor={book.anchorNote}
          onJump={review.jumpTo} onReplaceAll={book.replaceAll}
          tab={panelTab} onTabChange={setPanelTab} findFocusToken={findFocusToken}
        />
      }
      status={
        <>
          <span>{book.chapter?.title ?? "—"}</span>
          <span>
            Verified {book.chapter?.verifiedCount ?? 0} / {book.chapter?.segmentCount ?? 0}
          </span>
          <span>Unlinked notes {book.unanchoredNotes.length}</span>
          <span className="hidden items-center gap-3 lg:flex">
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
    </DraftContext>
  )
}

export default App
