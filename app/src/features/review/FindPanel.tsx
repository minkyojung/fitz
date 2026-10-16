import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/data/http"
import type { SearchHit } from "@/data/api"

interface Props {
  /** Bumps after any write so results refresh. */
  refreshKey: unknown
  onJump: (segmentId: number, chapterId: number) => void
  onReplaceAll: (query: string, replacement: string) => Promise<unknown>
  /** When set, the query input takes focus (⌘F). */
  focusToken: number
}

/** Book-wide literal search with replace-all. Replacement is one undo step. */
export function FindPanel({ refreshKey, onJump, onReplaceAll, focusToken }: Props) {
  const [query, setQuery] = useState("")
  const [replacement, setReplacement] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusToken) inputRef.current?.select()
  }, [focusToken])

  useEffect(() => {
    if (!query) { setHits([]); return }
    let live = true
    const t = window.setTimeout(() => void api.search(query).then((h) => live && setHits(h)), 200)
    return () => { live = false; window.clearTimeout(t) }
  }, [query, refreshKey])

  const total = hits.reduce((n, h) => n + h.count, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-2">
        <Input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="찾을 말" aria-label="찾을 말" />
        <div className="flex gap-2">
          <Input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="바꿀 말" aria-label="바꿀 말" />
          <Button size="sm" variant="outline" disabled={!query || !hits.length} onClick={() => void onReplaceAll(query, replacement)}>
            모두 바꾸기{total ? ` (${total})` : ""}
          </Button>
        </div>
        {query && (
          <p className="text-xs text-muted-foreground tabular-nums" role="status">
            {hits.length ? `${hits.length}개 단락, ${total}곳` : "일치하는 곳이 없습니다"}
          </p>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="divide-y text-xs">
          {hits.map((h) => (
            <li key={h.segmentId}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-muted/50" onClick={() => onJump(h.segmentId, h.chapterId)}>
                <div className="mb-0.5 flex gap-2 text-muted-foreground">
                  <span className="truncate">{h.chapterTitle}</span>
                  <span className="ml-auto shrink-0 tabular-nums">p. {h.pageStart}{h.count > 1 ? ` · ${h.count}곳` : ""}</span>
                </div>
                <p className="reading text-[13px]" lang="en">…{h.snippet}…</p>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}
