import { useEffect, useEffectEvent, useState, type ReactNode } from "react"
import { IconAlertTriangle, IconCheck, IconLoader2, IconMessage, IconSparkles, IconX } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import type { CardAnswer, Chapter, SessionCard, SessionChallenge, SessionDay } from "@/data/api"
import { api } from "@/data/http"
import type { Pointed } from "@/lib/conversation"
import { cn } from "cn"

// Session (docs/session.md, the gallery ?gallery&session): the day's quiz, one card at a time. The server grades and
// keeps where each card goes; this page holds only the round being answered — the cards as they stood at Start, and a
// card answered wrong put back at the end until it is answered right.

interface Props {
  day: SessionDay | null
  error: string | null
  chapters: Chapter[]
  /** The day as the server has it now (after More or Make more). */
  reload: () => Promise<SessionDay | null>
  /** Open the paragraph in Translate. */
  onJump: (segmentId: number, chapterId: number) => void
  /** Talk it over with Claude: the paragraph in Translate, these words waiting in Claude's box. */
  onDiscuss: (pointed: Pointed, chapterId: number) => void
}

type View = "overview" | "cards" | "challenges" | "done"
type Decision = "keep" | "discuss" | "change"

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
/** A time as SQLite keeps it (UTC, no zone written), as the clock on the wall shows it. */
const clockOf = (sqlite: string) => new Date(`${sqlite.replace(" ", "T")}Z`).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
const enterKbd = <Kbd className="bg-primary-foreground/20 text-primary-foreground">↵</Kbd>

export function SessionPage({ day, error, chapters, reload, onJump, onDiscuss }: Props) {
  const [view, setView] = useState<View>("overview")
  const [queue, setQueue] = useState<SessionCard[]>([])
  const [challenges, setChallenges] = useState<SessionChallenge[]>([])
  const [pos, setPos] = useState(0)
  const [ci, setCi] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [answer, setAnswer] = useState<CardAnswer | null>(null)
  const [aside, setAside] = useState<Record<number, "known" | "disputed">>({})
  const [decided, setDecided] = useState<Record<number, Decision>>({})
  const [first, setFirst] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const chapterTitle = (id: number) => chapters.find((c) => c.id === id)?.title ?? ""

  const startWith = (d: SessionDay) => {
    setQueue(d.cards); setChallenges(d.challenges); setPos(0); setCi(0); setPicked(null); setAnswer(null); setFailure(null)
    setView(d.cards.length ? "cards" : d.challenges.length ? "challenges" : "done")
  }
  const card = view === "cards" ? queue[pos] : null
  const challenge = view === "challenges" ? challenges[ci] : null

  /** Some call to the server, one at a time; what went wrong is said where it happened. */
  const act = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setFailure(null)
    try { return await fn() } catch (e) { setFailure((e as Error).message); return undefined } finally { setBusy(false) }
  }
  const nextCard = (skip?: number) => {
    setPicked(null); setAnswer(null); setFailure(null)
    let p = pos + 1
    while (p < queue.length && (aside[queue[p].id] || queue[p].id === skip)) p++
    if (p < queue.length) setPos(p)
    else setView(challenges.length ? "challenges" : "done")
  }
  const choose = async (i: number) => {
    if (!card || picked !== null || busy || aside[card.id]) return
    setPicked(i)
    const got = await act(() => api.answerCard(card.id, i))
    if (!got) return
    setAnswer(got)
    setFirst((f) => (card.id in f ? f : { ...f, [card.id]: got.correct }))
    if (!got.correct) setQueue((q) => [...q, { ...card, again: true }])  // until it is answered right
  }
  const setCardAside = async (why: "known" | "disputed") => {
    if (!card) return
    const done = await act(() => api.setCardAside(card.id, why))
    if (done === undefined) return
    setAside((a) => ({ ...a, [card.id]: why }))
    setQueue((q) => q.filter((c, j) => j <= pos || c.id !== card.id))
    if (why === "known") nextCard(card.id)
  }
  const decide = async (d: Decision) => {
    if (!challenge) return
    const done = await act(() => api.decideChallenge(challenge.id, d))
    if (done === undefined) return
    setDecided((x) => ({ ...x, [challenge.id]: d }))
    if (d === "discuss") onDiscuss({ segmentId: challenge.segmentId, side: "target", quote: challenge.quote }, challenge.chapterId)
  }
  const nextChallenge = () => { setFailure(null); if (ci + 1 < challenges.length) setCi(ci + 1); else setView("done") }
  const more = async (kind: "cards" | "challenges") => {
    if ((await act(() => api.moreToday(kind))) === undefined) return
    const d = await reload()
    if (d) startWith(d)
  }
  const makeMore = async () => { if ((await act(() => api.makeMoreCards())) !== undefined) setView("overview") }
  const retry = async () => { await act(() => api.retryEvening()) }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable=true]")) return
    if (view === "overview" && e.key === "Enter" && day && (day.cards.length || day.challenges.length)) { e.preventDefault(); startWith(day) }
    else if (card && /^[1-4]$/.test(e.key)) { e.preventDefault(); void choose(Number(e.key) - 1) }
    else if (card && e.key === "Enter" && (answer || failure) && !busy) { e.preventDefault(); nextCard() }
    else if (challenge && e.key === "Enter" && (decided[challenge.id] || failure) && !busy) { e.preventDefault(); nextChallenge() }
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  if (!day) return <p className="p-6 text-sm text-muted-foreground">{error ?? "Loading Session…"}</p>
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8" data-session={view}>
      {view === "overview" && <Overview day={day} busy={busy} onStart={() => startWith(day)} onRetry={retry} onMakeMore={makeMore} failure={failure} />}
      {card && (
        <CardView card={card} pos={pos} total={queue.length} picked={picked} answer={answer} aside={aside[card.id]} busy={busy} failure={failure}
          chapter={chapterTitle(card.chapterId)} today={day.today}
          onChoose={choose} onNext={() => nextCard()} onKnow={() => setCardAside("known")} onDispute={() => setCardAside("disputed")}
          onJump={() => onJump(card.segmentId, card.chapterId)}
          onDiscuss={() => onDiscuss({ segmentId: card.segmentId, side: "source", quote: card.quote }, card.chapterId)} />
      )}
      {challenge && (
        <ChallengeView challenge={challenge} index={ci} total={challenges.length} decided={decided[challenge.id]} busy={busy} failure={failure}
          chapter={chapterTitle(challenge.chapterId)} onDecide={decide} onNext={nextChallenge} onJump={() => onJump(challenge.segmentId, challenge.chapterId)} />
      )}
      {view === "done" && <Done day={day} first={first} aside={aside} decided={decided} busy={busy} failure={failure} onMore={more} onMakeMore={makeMore} />}
    </div>
  )
}

/** How the evening's run went, in one line. */
function EveningLine({ day, onRetry, busy }: { day: SessionDay; onRetry: () => void; busy: boolean }) {
  const { running, last } = day.evening
  const line: ReactNode = running ? <><IconLoader2 className="size-4 animate-spin" />Claude is making cards from the paragraphs that changed…</>
    : !last ? <>Claude makes cards every evening at 21:00 from the paragraphs whose translation changed that day.</>
    : last.status === "failed" ? (
      <>
        <IconAlertTriangle className="size-4 text-destructive" />
        {last.slot === day.today ? "Tonight's" : `${last.slot}'s`} cards could not be made: {last.error} (tried {last.tries} {last.tries === 1 ? "time" : "times"}).
        <Button size="sm" variant="outline" className="ml-1" onClick={onRetry} disabled={busy}>Try again</Button>
      </>
    ) : last.status === "skipped" ? <>Nothing changed {last.slot === day.today ? "today" : `on ${last.slot}`}, so there were no new cards.</>
    : <><IconCheck className="size-4 text-mark-term-ink" />Made {last.made} {last.made === 1 ? "card" : "cards"}{last.finishedAt ? ` at ${clockOf(last.finishedAt)}` : ""}{last.slot === day.today ? "" : ` for ${last.slot}`} from the paragraphs that changed.</>
  return <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-evening={running ? "running" : last?.status ?? "none"}>{line}</p>
}

function Overview({ day, busy, failure, onStart, onRetry, onMakeMore }: {
  day: SessionDay; busy: boolean; failure: string | null; onStart: () => void; onRetry: () => void; onMakeMore: () => void
}) {
  const fresh = day.cards.filter((c) => c.isNew && !c.again).length
  const counts = [[fresh, "new"], [day.cards.length - fresh, "to review"], [day.challenges.length, day.challenges.length === 1 ? "challenge" : "challenges"]] as const
  const any = day.cards.length + day.challenges.length > 0
  return (
    <div className="space-y-6">
      <EveningLine day={day} onRetry={onRetry} busy={busy} />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Today's session</h1>
        <p className="text-sm text-muted-foreground">{any ? counts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`).join(" · ") : "Nothing to ask today."}</p>
      </div>
      {any ? (
        <Button onClick={onStart}>Start {enterKbd}</Button>
      ) : day.waiting.cards === 0 && !day.evening.running && (
        <Button variant="outline" onClick={onMakeMore} disabled={busy}><IconSparkles />Make more from the last 7 days</Button>
      )}
      {failure && <p className="text-xs text-destructive">{failure}</p>}
      <p className="max-w-md text-xs text-muted-foreground">
        A card comes back after 1, 2, 4, 8 and 16 days; right the fifth time, it is learned. A wrong answer comes back at the end of the
        session until you get it, and the next day the card starts over.
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">Learning {day.stats.learning} · Learned {day.stats.learned} · Set aside {day.stats.setAside}</p>
    </div>
  )
}

/** The English with the words asked about underlined. */
function Quoted({ text, quote }: { text: string; quote: string }) {
  const i = text.indexOf(quote)
  if (i === -1) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="bg-transparent text-inherit underline decoration-primary/60 decoration-2 underline-offset-4">{quote}</mark>{text.slice(i + quote.length)}</>
}

function CardView({ card, pos, total, picked, answer, aside, busy, failure, chapter, today, onChoose, onNext, onKnow, onDispute, onJump, onDiscuss }: {
  card: SessionCard; pos: number; total: number; picked: number | null; answer: CardAnswer | null; aside?: "known" | "disputed"; busy: boolean
  failure: string | null; chapter: string; today: string
  onChoose: (i: number) => void; onNext: () => void; onKnow: () => void; onDispute: () => void; onJump: () => void; onDiscuss: () => void
}) {
  const where = !answer ? "" : !answer.correct ? "Again at the end of this session until you get it; tomorrow it starts over from box 1"
    : !answer.first ? "Box 1 · tomorrow"
    : answer.status === "learned" ? "Learned — it won't come back"
    : `Box ${card.box} → ${answer.box} · back in ${days(today, answer.dueOn)} days`
  return (
    <div className="space-y-5" data-card={card.id}>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Progress value={Math.round((pos / total) * 100)} aria-label="Session progress" className="flex-1" />
        <span className="tabular-nums">{pos + 1} / {total}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">{card.kind === "meaning" ? "Meaning" : "Nuance"}</Badge>
        <span className="text-muted-foreground">{card.again ? "Once more" : card.isNew ? "New" : `Box ${card.box} of 5`}</span>
        {card.origin !== "claude" && <span className="text-muted-foreground">· {card.origin === "picked" ? "you picked it" : "you asked about it"}</span>}
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={onJump}>¶{card.segmentId}{chapter && ` · ${chapter}`}</Button>
      </div>
      <p className="reading text-[17px] leading-relaxed" lang="en"><Quoted text={card.sentence} quote={card.quote} /></p>
      <p className="text-sm font-medium">{card.question}</p>
      <ol className="space-y-1.5" aria-label="Options">
        {card.options.map((o, i) => {
          const right = answer && i === answer.answer
          const wrong = answer && i === picked && !answer.correct
          return (
            <li key={i}>
              <button type="button" onClick={() => onChoose(i)} disabled={picked !== null || busy}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default",
                  picked === null ? "hover:bg-muted" : right ? "border-mark-term-ink/40 bg-mark-term/40" : wrong ? "border-mark-warning-ink/40 bg-mark-warning/40" : "text-muted-foreground",
                )}>
                <Kbd>{i + 1}</Kbd>
                <span>{o}</span>
                {right && <IconCheck className="ml-auto size-4 text-mark-term-ink" aria-label="right" />}
                {wrong && <IconX className="ml-auto size-4 text-mark-warning-ink" aria-label="wrong" />}
              </button>
            </li>
          )
        })}
      </ol>
      {answer && (
        <div className="space-y-2 rounded-md bg-muted/50 px-3 py-2.5 text-sm" data-answer={answer.correct ? "right" : "wrong"}>
          <p className="font-medium">{answer.correct ? "Right." : `Not this one — ${answer.answer + 1} is right.`}</p>
          <p className="text-muted-foreground">{answer.why}</p>
          {answer.translation && (
            <>
              <p className="pt-1 text-xs text-muted-foreground">¶{card.segmentId} as translated now</p>
              <p className="reading text-[15px]" lang="ko">{answer.translation}</p>
            </>
          )}
          <p className="pt-1 text-xs text-muted-foreground">{aside === "disputed" ? "Set aside — this card won't come back." : where}</p>
        </div>
      )}
      {failure && <p className="text-xs text-destructive">{failure}</p>}
      <footer className="flex items-center gap-1">
        {!aside && <Button size="sm" variant="ghost" onClick={onKnow} disabled={busy}>I know this</Button>}
        {answer && !aside && <Button size="sm" variant="ghost" onClick={onDispute} disabled={busy}>Answer looks wrong</Button>}
        {aside === "disputed" && <Button size="sm" variant="outline" onClick={onDiscuss}><IconMessage />Discuss with Claude</Button>}
        {(answer || failure) && <Button size="sm" className="ml-auto" onClick={onNext} disabled={busy}>Next {enterKbd}</Button>}
      </footer>
    </div>
  )
}

/** The translation with Claude's words in place of the quoted ones, in the suggestions' diff language. */
function Proposed({ text, quote, proposal }: { text: string; quote: string; proposal: string }) {
  const i = text.indexOf(quote)
  if (i === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="border-b-2 border-mark-warning bg-mark-warning/40 text-inherit line-through decoration-mark-warning-ink box-decoration-clone">{quote}</mark>{" "}
      <ins className="border-b-2 border-mark-term bg-mark-term/40 px-0.5 no-underline box-decoration-clone">{proposal}</ins>
      {text.slice(i + quote.length)}
    </>
  )
}

function ChallengeView({ challenge: ch, index, total, decided, busy, failure, chapter, onDecide, onNext, onJump }: {
  challenge: SessionChallenge; index: number; total: number; decided?: Decision; busy: boolean; failure: string | null; chapter: string
  onDecide: (d: Decision) => void; onNext: () => void; onJump: () => void
}) {
  const outcome: Record<Decision, string> = {
    keep: "Kept as it is.",
    change: `¶${ch.segmentId} changed — ⌘Z undoes it.`,
    discuss: "Opened in Claude's panel, with these words.",
  }
  return (
    <div className="space-y-5" data-challenge={ch.id}>
      <p className="text-xs text-muted-foreground tabular-nums">Challenge {index + 1} of {total}</p>
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">Challenge</Badge>
        <span className="text-muted-foreground">{ch.writtenBy === "agent" ? "Claude's translation" : "Your translation"}</span>
        <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={onJump}>¶{ch.segmentId}{chapter && ` · ${chapter}`}</Button>
      </div>
      <p className="reading text-[15px] text-muted-foreground" lang="en">{ch.source}</p>
      <p className="reading text-[17px] leading-relaxed" lang="ko">
        {decided === "change" ? ch.translation.replace(ch.quote, ch.proposal) : <Proposed text={ch.translation} quote={ch.quote} proposal={ch.proposal} />}
      </p>
      <div className="space-y-1.5 text-sm">
        <p className="font-medium">{ch.question}</p>
        <p className="text-muted-foreground">{ch.why}</p>
        {ch.stale && !decided && <p className="text-xs text-muted-foreground">The translation changed since: these words are no longer in it exactly once.</p>}
      </div>
      {failure && <p className="text-xs text-destructive">{failure}</p>}
      {decided ? (
        <footer className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{outcome[decided]}</span>
          <Button size="sm" className="ml-auto" onClick={onNext}>Next {enterKbd}</Button>
        </footer>
      ) : (
        <footer className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => onDecide("keep")} disabled={busy}>Keep it</Button>
          <Button size="sm" variant="outline" onClick={() => onDecide("change")} disabled={busy || ch.stale}>Use the suggestion</Button>
          <Button size="sm" variant="ghost" onClick={() => onDecide("discuss")} disabled={busy}><IconMessage />Discuss with Claude</Button>
          {failure && <Button size="sm" className="ml-auto" onClick={onNext}>Next {enterKbd}</Button>}
        </footer>
      )}
    </div>
  )
}

function Done({ day, first, aside, decided, busy, failure, onMore, onMakeMore }: {
  day: SessionDay; first: Record<number, boolean>; aside: Record<number, "known" | "disputed">; decided: Record<number, Decision>
  busy: boolean; failure: string | null; onMore: (kind: "cards" | "challenges") => void; onMakeMore: () => void
}) {
  const answered = Object.keys(first).map(Number).filter((id) => !aside[id])
  const right = answered.filter((id) => first[id]).length
  const known = Object.values(aside).filter((a) => a === "known").length
  const disputed = Object.values(aside).filter((a) => a === "disputed").length
  const count = (d: Decision) => Object.values(decided).filter((x) => x === d).length
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Session done</h1>
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          <li>{answered.length} {answered.length === 1 ? "card" : "cards"} — {right} right the first time, {answered.length - right} back tomorrow</li>
          {known > 0 && <li>{known} set aside as known</li>}
          {disputed > 0 && <li>{disputed} set aside as a wrong answer</li>}
          {Object.keys(decided).length > 0 && <li>Challenges — {count("keep")} kept, {count("change")} changed, {count("discuss")} to discuss</li>}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {day.waiting.cards > 0 ? (
          <Button variant="outline" onClick={() => onMore("cards")} disabled={busy}>10 more <span className="text-muted-foreground">· {day.waiting.cards} waiting</span></Button>
        ) : (
          <Button variant="outline" onClick={onMakeMore} disabled={busy || day.evening.running}><IconSparkles />Make more from the last 7 days</Button>
        )}
        {day.waiting.challenges > 0 && (
          <Button variant="outline" onClick={() => onMore("challenges")} disabled={busy}>3 more challenges <span className="text-muted-foreground">· {day.waiting.challenges} waiting</span></Button>
        )}
      </div>
      {failure && <p className="text-xs text-destructive">{failure}</p>}
      <p className="text-xs text-muted-foreground">New cards every evening at 21:00, from what changes until then.</p>
    </div>
  )
}
