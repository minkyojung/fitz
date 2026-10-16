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
  { command: "selectNext", label: "이동" },
  { command: "toggleVerified", label: "확인" },
  { command: "startEdit", label: "수정" },
  { command: "undo", label: "되돌리기" },
]

const SAVE_LABEL: Record<SaveState, { text: string; className: string }> = {
  idle: { text: "", className: "" },
  saving: { text: "저장 중…", className: "text-muted-foreground" },
  saved: { text: "저장됨", className: "text-muted-foreground" },
  error: { text: "저장 실패", className: "text-destructive font-medium" },
}

export function App() {
  const [mode, setMode] = useState<Mode>("review")
  const book = useBook()
  const review = useReview({
    pages: book.pages, segments: book.segments,
    onPatch: book.updateSegment, onSplit: book.splitSegment, onMerge: book.mergeWithNext,
    onPageOutsideChapter: (pageNo) => {
      const target = chapterForPage(book.chapters, pageNo)
      if (target !== null && target !== book.chapterId) book.setChapterId(target)
    },
  })
  const { commands } = review
  useKeymap(useMemo(() => ({ ...commands, undo: book.undo, redo: book.redo }), [commands, book.undo, book.redo]))

  if (book.error) return <div className="p-8 text-destructive">API 연결 실패: {book.error}</div>

  return (
    <DraftContext value={book.drafts}>
    <AppShell
      mode={mode}
      onModeChange={setMode}
      sidebar={<ChapterList chapters={book.chapters} selectedId={book.chapterId} onSelect={book.setChapterId} />}
      left={review.left}
      right={review.right}
      panel={<ReviewPanel notes={book.unanchoredNotes} segments={book.segments} selected={review.selected} onAnchor={book.anchorNote} />}
      status={
        <>
          <span>{book.chapter?.title ?? "—"}</span>
          <span>
            확인 {book.chapter?.verifiedCount ?? 0} / {book.chapter?.segmentCount ?? 0}
          </span>
          <span>미연결 미주 {book.unanchoredNotes.length}</span>
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
            <Button variant="ghost" size="icon-xs" aria-label="되돌리기" onClick={() => void book.undo()}>
              <IconArrowBackUp />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="다시 실행" onClick={() => void book.redo()}>
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
