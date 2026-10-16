import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { findSuspects, loadEnglishSpeller, type Speller, type Suspect } from "@/lib/spell"

const INITIAL = [
  "Sam Zemurray spoke with no accent, except when he swore, which was all the time. He was a big man, six foot three, rangy, nothing but muscle and bone, with the wingspan of a condor, hooded eyes, and a crisp, no-nonsense manner.",
  "In this one, the Central American isthmus where he cleafed the jungle and made his fortune. After ten years in the South, he was known by a variety of nicknames: Z, the Russian, Sam the Banana Man, El Amigo, the Gringo.",
  "Tt was a brisk night in the winter of 1910. Zemurray stood under the clock in front of Holmes department store taking in the cheap twinkle of Canal Street. He became a Hondurefio.",
  "He read the Fruit Dispatch every morning and took the train to Mobile, where the Cuyamel Fruit Company kept its wharf.",
]

/** How spell suspects look in the review list: dotted underline on a tint; hover explains; click offers
 *  Hunspell suggestions and "add to dictionary". */
export function SpellGallery() {
  const [speller, setSpeller] = useState<Speller | null>(null)
  const [paras, setParas] = useState(INITIAL)
  const [userWords, setUserWords] = useState<Set<string>>(new Set())
  useEffect(() => { void loadEnglishSpeller().then(setSpeller) }, [])

  const suspects = useMemo(
    () => (speller ? paras.map((p) => findSuspects(p, speller.correct, userWords)) : paras.map(() => [])),
    [speller, paras, userWords],
  )
  const total = suspects.reduce((n, s) => n + s.length, 0)
  const addWord = (w: string) => setUserWords((prev) => new Set(prev).add(w))
  const replace = (i: number, s: Suspect, to: string) =>
    setParas((ps) => ps.map((p, k) => (k === i ? p.slice(0, s.start) + to + p.slice(s.end) : p)))

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-8">
      <h1 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        맞춤법 의심 단어 갤러리 · 호버 설명 · 클릭하면 교정 후보와 "사전에 추가"
        <Badge variant={total ? "secondary" : "outline"} className="ml-auto">의심 단어 {speller ? total : "…"}</Badge>
      </h1>
      {paras.map((text, i) => (
        <div key={i} className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
          <div className="mb-1 flex h-6 items-center gap-1.5 text-xs">
            <Checkbox aria-label="확인됨" /><span className="text-muted-foreground">확인</span>
            <Badge variant="outline">단락</Badge>
            {suspects[i].length > 0 && <span className="ml-auto text-muted-foreground tabular-nums">의심 {suspects[i].length}</span>}
          </div>
          <p className="reading text-[15px]" lang="en">
            {renderWithSuspects(text, suspects[i], speller, addWord, (s, to) => replace(i, s, to))}
          </p>
        </div>
      ))}
      {userWords.size > 0 && <p className="text-xs text-muted-foreground">사전에 추가됨: {[...userWords].join(", ")}</p>}
    </div>
  )
}

export const SPELL_MARK_CLASS =
  "rounded-sm bg-mark-warning/50 text-inherit underline decoration-destructive/70 decoration-dotted decoration-2 underline-offset-4 cursor-pointer"

function renderWithSuspects(
  text: string, suspects: Suspect[], speller: Speller | null,
  onAdd: (w: string) => void, onReplace: (s: Suspect, to: string) => void,
) {
  const out: React.ReactNode[] = []
  let pos = 0
  suspects.forEach((s, i) => {
    out.push(text.slice(pos, s.start))
    out.push(<SuspectMark key={i} suspect={s} speller={speller} onAdd={onAdd} onReplace={onReplace} />)
    pos = s.end
  })
  out.push(text.slice(pos))
  return out
}

function SuspectMark({ suspect: s, speller, onAdd, onReplace }: {
  suspect: Suspect; speller: Speller | null; onAdd: (w: string) => void; onReplace: (s: Suspect, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const suggestions = useMemo(() => (open && speller ? speller.suggest(s.word) : []), [open, speller, s.word])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<mark data-spell className={SPELL_MARK_CLASS} />} />}>
          {s.word}
        </TooltipTrigger>
        <TooltipContent side="top">사전에 없는 단어 · 클릭하면 교정 후보</TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-56 p-1">
        <div className="px-2 py-1 text-xs text-muted-foreground">“{s.word}”</div>
        {suggestions.length ? (
          suggestions.map((sug) => (
            <Button key={sug} variant="ghost" size="sm" className="w-full justify-start font-normal" onClick={() => { onReplace(s, sug); setOpen(false) }}>
              {sug}
            </Button>
          ))
        ) : (
          <div className="px-2 py-1 text-xs text-muted-foreground">교정 후보 없음</div>
        )}
        <div className="my-1 border-t" />
        <Button variant="ghost" size="sm" className="w-full justify-start font-normal" onClick={() => { onAdd(s.word); setOpen(false) }}>
          사전에 추가
        </Button>
      </PopoverContent>
    </Popover>
  )
}
