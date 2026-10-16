import { useEffect, useState } from "react"

import { api } from "@/data/http"
import type { Chapter, Segment } from "@/data/api"

export function App() {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listChapters()
      .then((cs) => {
        setChapters(cs)
        return cs.length ? api.listSegments(cs[1]?.id ?? cs[0].id) : []
      })
      .then(setSegments)
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) return <div className="p-8 text-destructive">API 연결 실패: {error}</div>

  return (
    <div className="flex min-h-svh gap-8 p-8">
      <aside className="w-56 shrink-0 text-xs">
        {chapters.map((c) => (
          <div key={c.id} className="flex justify-between py-1">
            <span className="truncate">{c.title}</span>
            <span className="tabular-nums text-muted-foreground">
              {c.verifiedCount}/{c.segmentCount}
            </span>
          </div>
        ))}
      </aside>
      <main className="reading" lang="en">
        {segments.map((s) => (
          <p key={s.id} className="mb-4">
            <span className="mr-2 text-xs tabular-nums text-muted-foreground">p.{s.pageStart}</span>
            {s.kind === "heading" ? <strong>{s.sourceText}</strong> : s.sourceText}
          </p>
        ))}
      </main>
    </div>
  )
}

export default App
