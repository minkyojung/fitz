import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { findSuspects, loadEnglishChecker, type Checker } from "@/lib/spell"

const PARAS = [
  "Sam Zemurray spoke with no accent, except when he swore, which was all the time. He was a big man, six foot three, rangy, nothing but muscle and bone, with the wingspan of a condor, hooded eyes, and a crisp, no-nonsense manner.",
  "In this one, the Central American isthmus where he cleafed the jungle and made his fortune. After ten years in the South, he was known by a variety of nicknames: Z, the Russian, Sam the Banana Man, El Amigo, the Gringo.",
  "Tt was a brisk night in the winter of 1910. Zemurray stood under the clock in front of Holmes department store taking in the cheap twinkle of Canal Street. He became a Hondurefio.",
  "He read the Fruit Dispatch every morning and took the train to Mobile, where the Cuyamel Fruit Company kept its wharf.",
]

/** How spell suspects look in the review list: dotted underline, tooltip, right-click to add to the dictionary. */
export function SpellGallery() {
  const [correct, setCorrect] = useState<Checker | null>(null)
  const [userWords, setUserWords] = useState<Set<string>>(new Set())
  useEffect(() => { void loadEnglishChecker().then((c) => setCorrect(() => c)) }, [])

  const suspects = useMemo(
    () => (correct ? PARAS.map((p) => findSuspects(p, correct, userWords)) : PARAS.map(() => [])),
    [correct, userWords],
  )
  const total = suspects.reduce((n, s) => n + s.length, 0)
  const addWord = (w: string) => setUserWords((prev) => new Set(prev).add(w))

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-8">
      <h1 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        맞춤법 의심 단어 갤러리 · 점선 밑줄, 호버 설명, 우클릭 "사전에 추가"
        <Badge variant={total ? "secondary" : "outline"} className="ml-auto">의심 단어 {correct ? total : "…"}</Badge>
      </h1>
      {PARAS.map((text, i) => (
        <div key={i} className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
          <div className="mb-1 flex h-6 items-center gap-1.5 text-xs">
            <Checkbox aria-label="확인됨" /><span className="text-muted-foreground">확인</span>
            <Badge variant="outline">단락</Badge>
            {suspects[i].length > 0 && <span className="ml-auto text-muted-foreground tabular-nums">의심 {suspects[i].length}</span>}
          </div>
          <p className="reading text-[15px]" lang="en">
            {renderWithSuspects(text, suspects[i], addWord)}
          </p>
        </div>
      ))}
      {userWords.size > 0 && (
        <p className="text-xs text-muted-foreground">사전에 추가됨: {[...userWords].join(", ")}</p>
      )}
    </div>
  )
}

function renderWithSuspects(text: string, suspects: { start: number; end: number; word: string }[], onAdd: (w: string) => void) {
  const out: React.ReactNode[] = []
  let pos = 0
  suspects.forEach((s, i) => {
    out.push(text.slice(pos, s.start))
    out.push(
      <ContextMenu key={i}>
        <ContextMenuTrigger
          render={<mark data-spell title="사전에 없는 단어" className="bg-transparent text-inherit underline decoration-mark-warning decoration-dotted decoration-2 underline-offset-4" />}
        >
          {s.word}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onAdd(s.word)}>“{s.word}” 사전에 추가</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    )
    pos = s.end
  })
  out.push(text.slice(pos))
  return out
}
