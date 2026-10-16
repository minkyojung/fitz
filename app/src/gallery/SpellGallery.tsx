import { useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandGroup, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { findSuspects, loadEnglishSpeller, type Speller, type Suspect } from "@/lib/spell"
import { buildCorpus, type Corpus } from "@/lib/corpus"
import { neighbours, rankCandidates } from "@/lib/rank"
import { api } from "@/data/http"

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
  const [corpus, setCorpus] = useState<Corpus>(() => buildCorpus(INITIAL))
  const [corpusSource, setCorpusSource] = useState("예문 4개")
  useEffect(() => { void loadEnglishSpeller().then(setSpeller) }, [])
  // Language model from the whole book when the API is up; falls back to the sample paragraphs.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const chapters = await api.listChapters()
        const texts: string[] = []
        for (const c of chapters) for (const s of await api.listSegments(c.id)) texts.push(s.sourceText)
        if (!live) return
        const c = buildCorpus(texts)
        setCorpus(c)
        setCorpusSource(`책 전체 ${c.total.toLocaleString()}단어`)
      } catch { /* no server: keep the sample corpus */ }
    })()
    return () => { live = false }
  }, [])

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
        맞춤법 의심 단어 갤러리 · 확실한 교정은 git diff처럼(취소선 → 초록, 초록 클릭해 수락) · 단어 클릭하면 전체 후보 / "사전에 추가"
        <span className="ml-auto text-muted-foreground">문맥 통계: {corpusSource}</span>
        <Badge variant={total ? "secondary" : "outline"}>의심 단어 {speller ? total : "…"}</Badge>
      </h1>
      {paras.map((text, i) => (
        <div key={i} className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
          <div className="mb-1 flex h-6 items-center gap-1.5 text-xs">
            <Checkbox aria-label="확인됨" /><span className="text-muted-foreground">확인</span>
            <Badge variant="outline">단락</Badge>
            {suspects[i].length > 0 && <span className="ml-auto text-muted-foreground tabular-nums">의심 {suspects[i].length}</span>}
          </div>
          <p className="reading text-[15px]" lang="en">
            {renderWithSuspects(text, suspects[i], speller, corpus, addWord, (s, to) => replace(i, s, to))}
          </p>
        </div>
      ))}
      {userWords.size > 0 && <p className="text-xs text-muted-foreground">사전에 추가됨: {[...userWords].join(", ")}</p>}
    </div>
  )
}

export const SPELL_STRUCK_CLASS =
  "rounded-sm bg-mark-warning/60 px-0.5 text-destructive line-through decoration-destructive/60 cursor-pointer"
export const SPELL_MARK_CLASS =
  "rounded-sm bg-mark-warning/50 text-inherit underline decoration-destructive/70 decoration-dotted decoration-2 underline-offset-4 cursor-pointer"

function renderWithSuspects(
  text: string, suspects: Suspect[], speller: Speller | null, corpus: Corpus,
  onAdd: (w: string) => void, onReplace: (s: Suspect, to: string) => void,
) {
  const out: React.ReactNode[] = []
  let pos = 0
  suspects.forEach((s, i) => {
    out.push(text.slice(pos, s.start))
    out.push(<SuspectMark key={i} suspect={s} context={neighbours(text, s.start, s.end)} speller={speller} corpus={corpus} onAdd={onAdd} onReplace={onReplace} />)
    pos = s.end
  })
  out.push(text.slice(pos))
  return out
}

/** A top candidate backed by evidence from this book (frequency or neighbour pairs) is shown inline;
 *  a bare dictionary look-alike with no evidence is not. */
const CONFIDENT = 1

function SuspectMark({ suspect: s, context, speller, corpus, onAdd, onReplace }: {
  suspect: Suspect; context: { prev?: string; next?: string }; speller: Speller | null; corpus: Corpus
  onAdd: (w: string) => void; onReplace: (s: Suspect, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // candidates ranked by OCR-error likelihood × how the word fits this book and its neighbours
  const ranked = useMemo(
    () => (speller ? rankCandidates(s.word, context, speller.suggest, speller.correct, corpus) : []),
    [speller, corpus, s.word, context],
  )
  const suggestions = ranked.map((r) => r.word)
  const top = ranked[0] && ranked[0].score >= CONFIDENT ? ranked[0].word : null
  // Confident fix: the same diff language as the history panel — struck original, inserted replacement.
  // Click the insertion to accept; click the original for all candidates / add to dictionary.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<mark data-spell className={top ? SPELL_STRUCK_CLASS : SPELL_MARK_CLASS} />}
      >
        {s.word}
      </PopoverTrigger>
      {top && (
        <>
          {" "}
          <ins
            data-spell-fix
            role="button"
            tabIndex={0}
            className="cursor-pointer rounded-sm bg-mark-term px-0.5 no-underline hover:brightness-95"
            title="클릭하면 이 후보로 바꿉니다"
            onClick={() => onReplace(s, top)}
            onKeyDown={(e) => e.key === "Enter" && onReplace(s, top)}
          >
            {top}
          </ins>
        </>
      )}
      <PopoverContent side="bottom" align="start" className="w-52 p-0" initialFocus={listRef}>
        <Command ref={listRef} tabIndex={-1} className="outline-none">
          <CommandList>
            <CommandGroup heading={`“${s.word}”`}>
              {suggestions.length ? (
                suggestions.map((sug) => (
                  <CommandItem key={sug} value={sug} onSelect={() => { onReplace(s, sug); setOpen(false) }}>
                    {sug}
                  </CommandItem>
                ))
              ) : (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">교정 후보 없음</div>
              )}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="__add" onSelect={() => { onAdd(s.word); setOpen(false) }}>
                사전에 추가
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
