import { useEffect, useState } from "react"
import { IconCheck, IconMessage, IconSparkles, IconX } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "cn"

// Design check for docs/agent.md §4 (step 7) before it is built: Claude's review of translations and its OCR-error
// hunt, shown the way familiar tools show suggestions — Google Docs' suggesting mode and Grammarly's side list for the
// review, the spelling underline for OCR errors. Claude only finds; nothing changes until the translator clicks.
// Sample text: The Great Gatsby (public domain).

type Suggestion = { id: number; para: number; quote: string; replacement: string; why: string; level?: "high" | "medium" | "low" }
type State = "idle" | "running" | "done"

const PAIRS = [
  {
    en: "In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since.",
    ko: "내가 더 어리고 더 상처받기 쉬웠던 시절, 아버지는 내게 충고를 하나 해 주셨는데 나는 그 뒤로 줄곧 그 말을 마음속에서 뒤집어 보고 있다.",
  },
  {
    en: "“Whenever you feel like criticizing any one,” he told me, “just remember that all the people in this world haven't had the advantages that you've had.”",
    ko: "“누군가를 비판하고 싶어질 때마다,” 아버지는 말씀하셨다. “세상 사람들이 다 너만큼 유리한 조건을 가진 건 아니라는 걸 기억하거라.”",
  },
  {
    en: "He didn't say any more, but we've always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that.",
    ko: "아버지는 더 말씀하지 않으셨지만, 우리 부자는 늘 말을 아끼면서도 유난히 잘 통하는 사이였기에, 나는 그 말에 훨씬 더 많은 뜻이 담겨 있음을 알았다.",
  },
]
const REVIEW: Suggestion[] = [
  { id: 1, para: 0, quote: "마음속에서 뒤집어 보고 있다", replacement: "곱씹어 왔다", level: "high", why: "turning over in my mind는 '되새기다'라는 관용 표현입니다. '뒤집어 보다'는 직역이라 뜻이 어긋납니다." },
  { id: 2, para: 0, quote: "더 어리고 더 상처받기 쉬웠던", replacement: "지금보다 어리고 쉽게 상처받던", level: "medium", why: "비교급 more를 '더'로 두 번 옮기면 번역 투가 됩니다." },
  { id: 3, para: 1, quote: "유리한 조건을 가진", replacement: "좋은 환경에서 자란", level: "low", why: "advantages는 여기서 집안·교육 같은 혜택입니다. '유리한 조건'은 경쟁하는 말처럼 읽힙니다." },
]

const SOURCE = [
  "In consequence, I'm inclined to reverse all judgments, a habit that has opened up many curious natures to me and also made me the victim of not a few veteran boars.",
  "The abnormal mind is quick to detect and attach itse1f to this quality when it appears in a normal person, and so it came about that in college I was unjustly accused of being a politician.",
]
// what the dictionary already finds: words it cannot form
const DICTIONARY = [{ para: 1, word: "itse1f", fix: "itself" }]
// what Claude finds: real words that are wrong here
const TYPOS: Suggestion[] = [
  { id: 11, para: 0, quote: "reverse", replacement: "reserve", why: "앞 문장의 reserved와 이어지는 reserve judgment(판단을 미루다)입니다. reverse는 OCR이 글자를 바꿔 읽은 것으로 보입니다." },
  { id: 12, para: 0, quote: "boars", replacement: "bores", why: "'따분한 사람들'(bores)이 문맥에 맞습니다. boars(멧돼지)는 OCR 오인으로 보입니다." },
]

/** The diff language the spelling marks already use: the words struck on a warning tint, the fix in green. */
function Marked({ text, marks, onAccept }: { text: string; marks: { quote: string; replacement: string; id: number; why?: string }[]; onAccept: (id: number) => void }) {
  const parts: React.ReactNode[] = []
  let rest = text
  let key = 0
  for (const m of [...marks].sort((a, b) => text.indexOf(a.quote) - text.indexOf(b.quote))) {
    const at = rest.indexOf(m.quote)
    if (at === -1) continue
    parts.push(rest.slice(0, at))
    parts.push(
      <span key={key++} title={m.why}>
        <mark className="border-b-2 border-mark-warning bg-mark-warning/40 text-inherit line-through decoration-mark-warning-ink">{m.quote}</mark>{" "}
        <ins role="button" tabIndex={0} onClick={() => onAccept(m.id)} title="Click to accept"
          className="cursor-pointer border-b-2 border-mark-term bg-mark-term/40 px-0.5 no-underline hover:bg-mark-term/70">{m.replacement}</ins>
      </span>,
    )
    rest = rest.slice(at + m.quote.length)
  }
  parts.push(rest)
  return <>{parts}</>
}

/** Start, progress, done — the one line the agent's work gets in the panel. */
function Run({ label, state, done, start }: { label: string; state: State; done: string; start: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
      {state === "idle" && <Button size="xs" variant="outline" onClick={start}><IconSparkles data-icon="inline-start" />{label}</Button>}
      {state === "running" && <span className="text-muted-foreground"><IconSparkles className="mr-1 inline size-3.5 animate-pulse" />Claude is reading the chapter…</span>}
      {state === "done" && <span className="text-muted-foreground">{done}</span>}
    </div>
  )
}

function Card({ s, label, onAccept, onDismiss, onComment }: { s: Suggestion; label: string; onAccept: () => void; onDismiss: () => void; onComment?: () => void }) {
  return (
    <li className="space-y-1.5 border-b px-3 py-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">¶{s.para + 2}</span>
        {s.level && <Badge variant={s.level === "high" ? "destructive" : "secondary"}>{s.level}</Badge>}
        <Badge variant="outline">{label}</Badge>
      </div>
      <p><span className="line-through decoration-destructive/60">{s.quote}</span> → <span className="text-mark-term-ink">{s.replacement}</span></p>
      <p className="text-xs text-muted-foreground">{s.why}</p>
      <div className="flex gap-1">
        <Button size="xs" onClick={onAccept}><IconCheck data-icon="inline-start" />Accept</Button>
        <Button size="xs" variant="ghost" onClick={onDismiss}><IconX data-icon="inline-start" />Dismiss</Button>
        {onComment && <Button size="xs" variant="ghost" onClick={onComment}><IconMessage data-icon="inline-start" />Keep as comment</Button>}
      </div>
    </li>
  )
}

/** A fake run: Claude "reads" for a moment, then the suggestions appear. */
function useRun(): [State, () => void] {
  const [state, setState] = useState<State>("idle")
  useEffect(() => {
    if (state !== "running") return
    const t = setTimeout(() => setState("done"), 1400)
    return () => clearTimeout(t)
  }, [state])
  return [state, () => setState("running")]
}

export function SuggestionsGallery() {
  const [reviewState, startReview] = useRun()
  const [typoState, startTypos] = useRun()
  const [ko, setKo] = useState(PAIRS.map((p) => p.ko))
  const [en, setEn] = useState(SOURCE)
  const [open, setOpen] = useState<number[]>([...REVIEW, ...TYPOS].map((s) => s.id))
  const [log, setLog] = useState<string[]>([])
  const close = (id: number, what: string) => { setOpen((o) => o.filter((x) => x !== id)); setLog((l) => [what, ...l]) }
  const acceptReview = (id: number) => {
    const s = REVIEW.find((x) => x.id === id)!
    setKo((k) => k.map((t, i) => (i === s.para ? t.replace(s.quote, s.replacement) : t)))
    close(id, `¶${s.para + 2} translation changed (⌘Z undoes)`)
  }
  const acceptTypo = (id: number) => {
    const s = TYPOS.find((x) => x.id === id)!
    setEn((e) => e.map((t, i) => (i === s.para ? t.replace(s.quote, s.replacement) : t)))
    close(id, `¶${s.para + 4} source: ${s.quote} → ${s.replacement} (⌘Z undoes)`)
  }
  const review = reviewState === "done" ? REVIEW.filter((s) => open.includes(s.id)) : []
  const typos = typoState === "done" ? TYPOS.filter((s) => open.includes(s.id)) : []

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-8">
      <h1 className="text-xs font-medium text-muted-foreground">
        Claude 제안 갤러리 · 리뷰는 구글 독스 제안 모드 + Grammarly 목록처럼, OCR 오류는 맞춤법 밑줄처럼 · Claude는 찾기만, 바뀌는 건 누를 때만
      </h1>

      <section className="grid grid-cols-[1fr_340px] overflow-hidden rounded-md border">
        <div className="space-y-4 p-4">
          <p className="text-xs font-medium text-muted-foreground">Translate · 번역 리뷰</p>
          <div className="grid grid-cols-[1fr_1fr] gap-x-6 gap-y-4">
            {PAIRS.map((p, i) => (
              <div key={i} className="contents">
                <p className="reading text-[15px] text-muted-foreground" lang="en">{p.en}</p>
                <p className="reading text-[15px]" lang="ko">
                  <Marked text={ko[i]} marks={review.filter((s) => s.para === i)} onAccept={acceptReview} />
                </p>
              </div>
            ))}
          </div>
        </div>
        <aside className="border-l">
          <p className="border-b px-3 py-2 text-xs font-medium">Suggestions {review.length > 0 && <Badge variant="secondary">{review.length}</Badge>}</p>
          <Run label="Review this chapter with Claude" state={reviewState} start={startReview}
            done={review.length ? `${review.length} suggestion${review.length > 1 ? "s" : ""} · Claude read 3 paragraphs` : "All suggestions handled"} />
          <ul>{review.map((s) => (
            <Card key={s.id} s={s} label="Claude" onAccept={() => acceptReview(s.id)} onDismiss={() => close(s.id, `¶${s.para + 2} dismissed`)}
              onComment={() => close(s.id, `¶${s.para + 2} kept as a comment by Claude`)} />
          ))}</ul>
        </aside>
      </section>

      <section className="grid grid-cols-[1fr_340px] overflow-hidden rounded-md border">
        <div className="space-y-3 p-4">
          <p className="text-xs font-medium text-muted-foreground">Review · OCR 오류 — 노란 표시: 사전이 찾은 것(지금 있는 기능) / Claude가 찾은 것(새 기능), 모양은 같다</p>
          {en.map((text, i) => {
            const dict = DICTIONARY.filter((d) => d.para === i && text.includes(d.word)).map((d, k) => ({ id: 100 + k, quote: d.word, replacement: d.fix, why: "Dictionary: not a word" }))
            const claude = typos.filter((s) => s.para === i).map((s) => ({ ...s, why: `Claude: ${s.why}` }))
            return (
              <div key={i} className="rounded-md border bg-muted/40 px-2 py-1.5">
                <p className="mb-1 text-xs text-muted-foreground">¶{i + 4} · Paragraph</p>
                <p className="reading text-[15px]" lang="en">
                  <Marked text={text} marks={[...dict, ...claude]} onAccept={(id) => (id >= 100 ? setEn((e) => e.map((t, k) => (k === i ? t.replace(dict[id - 100].quote, dict[id - 100].replacement) : t))) : acceptTypo(id))} />
                </p>
              </div>
            )
          })}
        </div>
        <aside className="border-l">
          <p className="border-b px-3 py-2 text-xs font-medium">Suggestions {typos.length > 0 && <Badge variant="secondary">{typos.length}</Badge>}</p>
          <Run label="Find OCR errors with Claude" state={typoState} start={startTypos}
            done={typos.length ? `${typos.length} likely OCR error${typos.length > 1 ? "s" : ""} · check them against the scan` : "All suggestions handled"} />
          <ul>{typos.map((s) => (
            <Card key={s.id} s={{ ...s, para: s.para + 2 }} label="Claude · OCR" onAccept={() => acceptTypo(s.id)} onDismiss={() => close(s.id, `¶${s.para + 4} dismissed`)} />
          ))}</ul>
        </aside>
      </section>

      <div className={cn("text-xs text-muted-foreground", !log.length && "opacity-50")}>
        <p className="font-medium">What happened</p>
        {log.length ? log.map((l, i) => <p key={i}>{l}</p>) : <p>Nothing yet — Claude's suggestions change nothing until you click.</p>}
      </div>
    </div>
  )
}
