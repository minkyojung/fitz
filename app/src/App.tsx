import { useState } from "react"

import { AppShell, type Mode } from "@/layout/AppShell"
import { ChapterList } from "@/features/review/ChapterList"
import { useReview } from "@/features/review/ReviewView"
import { useBook } from "@/data/useBook"

function Placeholder({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{label}</div>
}

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
      panel={<Placeholder label="댓글 · 주석 · 용어집" />}
      status={
        <>
          <span>{book.chapter?.title ?? "—"}</span>
          <span>
            확인 {book.chapter?.verifiedCount ?? 0} / {book.chapter?.segmentCount ?? 0}
          </span>
        </>
      }
    />
  )
}

export default App
