import { useState } from "react"

import { AppShell, type Mode } from "@/layout/AppShell"
import { ChapterList } from "@/features/review/ChapterList"
import { NotesPanel } from "@/features/review/NotesPanel"
import { useReview } from "@/features/review/ReviewView"
import { useBook } from "@/data/useBook"

export function App() {
  const [mode, setMode] = useState<Mode>("review")
  const book = useBook()
  const review = useReview({ pages: book.pages, segments: book.segments, onPatch: book.updateSegment, onSplit: book.splitSegment, onMerge: book.mergeWithNext })

  if (book.error) return <div className="p-8 text-destructive">API 연결 실패: {book.error}</div>

  return (
    <AppShell
      mode={mode}
      onModeChange={setMode}
      sidebar={<ChapterList chapters={book.chapters} selectedId={book.chapterId} onSelect={book.setChapterId} />}
      left={review.left}
      right={review.right}
      panel={<NotesPanel notes={book.unanchoredNotes} segments={book.segments} onAnchor={book.anchorNote} />}
      status={
        <>
          <span>{book.chapter?.title ?? "—"}</span>
          <span>
            확인 {book.chapter?.verifiedCount ?? 0} / {book.chapter?.segmentCount ?? 0}
          </span>
          <span>미연결 미주 {book.unanchoredNotes.length}</span>
        </>
      }
    />
  )
}

export default App
