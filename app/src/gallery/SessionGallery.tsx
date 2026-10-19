import { useEffect, useEffectEvent, useState, type CSSProperties, type ReactNode } from "react"
import {
  IconAlertTriangle, IconBook, IconBook2, IconCards, IconCheck, IconFileExport, IconLanguage, IconLoader2, IconMessage, IconScan, IconSparkles,
  IconX,
} from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from "@/components/ui/sidebar"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "cn"

// Design check for Session before it is built: a quiz Claude makes every evening at 21:00 from the day's changed
// paragraphs — the translator's and Claude's — answered one card at a time until each is known; a card answered wrong
// comes back at the end of the session until it is answered right, and starts over the next day. Meaning and nuance
// cards have one right answer, which the code checks; a challenge questions a choice in the translation and is the
// translator's to decide. Shown in the shell ShellGallery plans (sidebar-07). Sample text: The Great Gatsby (public domain).

type Placement = "bottom" | "stages"
type Evening = "ready" | "making" | "failed" | "nothing"

/** Chapter I's paragraphs that changed today: the source and its translation now. */
const PARAS: Record<number, { en: string; ko: string }> = {
  1: {
    en: "In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since.",
    ko: "지금보다 어리고 쉽게 상처받던 시절, 아버지가 충고를 하나 해 주셨는데 나는 그 뒤로 줄곧 그 말을 곱씹어 왔다.",
  },
  2: {
    en: "“Whenever you feel like criticizing any one,” he told me, “just remember that all the people in this world haven't had the advantages that you've had.”",
    ko: "“누군가를 비판하고 싶어질 때면,” 아버지는 내게 말씀하셨다. “이 세상 모든 사람이 다 너처럼 좋은 조건을 누린 건 아니라는 걸 기억하렴.”",
  },
  3: {
    en: "He didn't say any more, but we've always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that.",
    ko: "아버지는 더 말이 없었지만, 우리는 말을 아끼면서도 잘 통했기에 나는 그 말의 깊은 뜻을 알았다.",
  },
  4: {
    en: "In consequence, I'm inclined to reserve all judgments, a habit that has opened up many curious natures to me and also made me the victim of not a few veteran bores. The abnormal mind is quick to detect and attach itself to this quality when it appears in a normal person, and so it came about that in college I was unjustly accused of being a politician, because I was privy to the secret griefs of wild, unknown men.",
    ko: "그래서 나는 남을 섣불리 판단하지 않는 버릇이 들었고, 덕분에 별난 사람들이 내게 속을 터놓았지만 지루한 이야기꾼들에게 시달리기도 했다. 비정상적인 사람일수록 평범한 사람의 이런 기질을 금세 알아보고 들러붙는 법이라, 대학 시절 나는 정치꾼이라는 억울한 소리를 들었다. 거칠고 이름 없는 사내들의 남모를 슬픔을 내가 다 알고 있었기 때문이다.",
  },
  5: {
    en: "Most of the confidences were unsought—frequently I have feigned sleep, preoccupation, or a hostile levity when I realized by some unmistakable sign that an intimate revelation was quivering on the horizon.",
    ko: "그 고백들은 대개 내가 청한 것이 아니었다. 누군가 속내를 털어놓으려 한다는 낌새가 분명해지면 나는 자는 척하거나, 딴생각에 빠진 척하거나, 일부러 빈정대며 가볍게 굴곤 했다.",
  },
}

interface Card { id: number; para: number; kind: "meaning" | "nuance"; isNew: boolean; box: number; sentence: string; quote: string; question: string; options: string[]; answer: number; why: string }
const CARDS: Card[] = [
  {
    id: 1, para: 1, kind: "meaning", isNew: true, box: 1, sentence: PARAS[1].en, quote: "turning over in my mind",
    question: "여기서 turning over in my mind의 뜻은?",
    options: ["마음속에서 뒤집어 엎어 왔다", "곱씹어 생각해 왔다", "마음을 고쳐먹어 왔다", "남에게 넘기지 않고 지녀 왔다"], answer: 1,
    why: "turn over (in one's mind)는 '이리저리 곱씹다'라는 관용 표현입니다. 뒤의 ever since(그 뒤로 줄곧)와 함께 오래 되새겨 왔다는 뜻이 됩니다.",
  },
  {
    id: 2, para: 4, kind: "nuance", isNew: false, box: 2, sentence: "In consequence, I'm inclined to reserve all judgments, a habit that has opened up many curious natures to me and also made me the victim of not a few veteran bores.",
    quote: "reserve all judgments", question: "여기서 reserve의 결에 가장 가까운 것은?",
    options: ["판단을 아껴 두는", "판단을 미리 정해 두는", "판단을 유보하는", "판단을 독차지하는"], answer: 2,
    why: "reserve judgment는 '판단을 내리지 않고 미루다'입니다. 앞 단락의 아버지 말(비판하고 싶어질 때면…)을 따르는 습관이니, 나중에 쓰려고 '아끼는' 것이 아니라 '유보'입니다.",
  },
  {
    id: 3, para: 4, kind: "meaning", isNew: true, box: 1, sentence: "In consequence, I'm inclined to reserve all judgments, a habit that has opened up many curious natures to me and also made me the victim of not a few veteran bores.",
    quote: "veteran bores", question: "veteran bores는 어떤 사람들인가?",
    options: ["이골이 난 따분한 사람들", "노련한 퇴역 군인들", "오래 일한 시추공들", "산전수전 겪은 사냥꾼들"], answer: 0,
    why: "bore는 '지루한 사람', veteran은 여기서 '그 일에 이골이 난'입니다. 판단을 유보하는 사람에게 지루한 이야기를 늘어놓는 사람들이 몰려들었다는 뜻입니다.",
  },
  {
    id: 4, para: 4, kind: "meaning", isNew: false, box: 3, sentence: "…and so it came about that in college I was unjustly accused of being a politician, because I was privy to the secret griefs of wild, unknown men.",
    quote: "privy to", question: "여기서 privy to의 뜻은?",
    options: ["~을 몰래 엿들어 알던", "~의 내막을 알고 있던", "~에게 사사로이 초대받던", "~의 비밀을 지켜 주던"], answer: 1,
    why: "be privy to는 '(남이 모르는 일을) 알고 있다'입니다. 바로 뒤 문장(Most of the confidences were unsought)이 말하듯 남들이 털어놓아서 안 것이지 엿들은 것이 아닙니다.",
  },
  {
    id: 5, para: 5, kind: "nuance", isNew: true, box: 1, sentence: PARAS[5].en, quote: "a hostile levity",
    question: "hostile levity의 결에 가장 가까운 것은?",
    options: ["적의 어린 경솔함", "대놓고 하는 조롱", "짐짓 가볍게 구는 태도", "퉁명스러운 침묵"], answer: 2,
    why: "levity는 '진지하지 않은 가벼움'입니다. 속내를 털어놓으려는 사람을 막으려고 자는 척, 딴생각하는 척과 나란히 고른 수단이니, 화를 내는 것이 아니라 일부러 가볍게 굴어 거리를 두는 태도입니다.",
  },
]

interface Challenge { id: number; para: number; by: "translator" | "agent"; quote: string; proposal: string; question: string; why: string }
const CHALLENGES: Challenge[] = [
  {
    id: 1, para: 3, by: "agent", quote: "말을 아끼면서도 잘 통했기에", proposal: "말을 아끼면서도 유난히 잘 통했기에",
    question: "원문의 unusually가 빠졌습니다. 말수는 적어도 남다르게 통했다는 것이 이 문장의 역설인데, 그대로 두시겠어요?",
    why: "unusually communicative in a reserved way는 '말을 아끼는 방식으로 유난히 잘 통하는'입니다. unusually가 빠지면 평범한 부자 사이처럼 읽힙니다.",
  },
  {
    id: 2, para: 2, by: "translator", quote: "좋은 조건을 누린", proposal: "혜택을 누린",
    question: "용어집에는 advantages를 '혜택'으로 정해 두셨는데, 여기서는 '좋은 조건'으로 옮기셨습니다. 이 문장만 다르게 두실 건가요?",
    why: "advantages는 집안·교육처럼 타고난 혜택입니다. 용어집과 다르게 두면 뒤에서 같은 말이 나올 때 표기가 흔들립니다.",
  },
]

/** Days until a card in each box comes back. Right moves a card up a box; right in box 5 and it is learned. Wrong: box 1. */
const INTERVAL: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 }

export function SessionGallery() {
  const [placement, setPlacement] = useState<Placement>("bottom")
  const [evening, setEvening] = useState<Evening>("ready")
  const [waiting, setWaiting] = useState(true)
  const [run, setRun] = useState(0)
  const controls = (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 text-xs">
      <SidebarTrigger />
      <span className="font-medium text-muted-foreground">Session 갤러리 · 매일 21:00에 그날 바뀐 단락(번역자·Claude)으로 카드를 만들고, 한 장씩 푼다</span>
      <Choice label="자리" value={placement} onChange={setPlacement} items={[["bottom", "A안 · 아래, Glossary 옆"], ["stages", "B안 · 위, 단계들 사이"]]} />
      <Choice label="저녁 실행" value={evening} onChange={setEvening}
        items={[["ready", "만들어짐"], ["making", "만드는 중"], ["failed", "실패"], ["nothing", "바뀐 것 없음"]]} />
      <Choice label="기다리는 카드" value={waiting ? "yes" : "no"} onChange={(v) => setWaiting(v === "yes")} items={[["yes", "있음"], ["no", "없음"]]} />
      <Button size="xs" variant="outline" onClick={() => setRun((r) => r + 1)}>처음부터</Button>
    </header>
  )
  return (
    <SidebarProvider style={{ "--sidebar-width": "15rem" } as CSSProperties}>
      <Frame key={`${evening}-${run}`} placement={placement} evening={evening} waiting={waiting} controls={controls} />
    </SidebarProvider>
  )
}

/** The sidebar and the Session page around one session's state: the sidebar's badge counts what is left of it. */
function Frame({ placement, evening, waiting, controls }: { placement: Placement; evening: Evening; waiting: boolean; controls: ReactNode }) {
  // without tonight's cards, only the reviews already due remain
  const cards = evening === "ready" ? CARDS : CARDS.filter((c) => !c.isNew)
  const challenges = evening === "ready" ? CHALLENGES : []
  const [view, setView] = useState<"overview" | "cards" | "challenges" | "done">("overview")
  /** Card ids in the order asked; a card answered wrong is put back at the end once. */
  const [queue, setQueue] = useState(() => cards.map((c) => c.id))
  const [pos, setPos] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [first, setFirst] = useState<Record<number, boolean>>({})
  const [aside, setAside] = useState<Record<number, "known" | "disputed">>({})
  const [ci, setCi] = useState(0)
  const [decided, setDecided] = useState<Record<number, "kept" | "changed" | "discuss">>({})

  const due = cards.filter((c) => first[c.id] === undefined && !aside[c.id]).length + challenges.filter((c) => !decided[c.id]).length
  const card = view === "cards" ? CARDS.find((c) => c.id === queue[pos])! : null
  const again = card !== null && queue.indexOf(card.id) !== pos
  const challenge = view === "challenges" ? challenges[ci] : null

  const start = () => setView(cards.length ? "cards" : challenges.length ? "challenges" : "done")
  const afterCards = () => setView(challenges.length ? "challenges" : "done")
  /** The next card not set aside; `skip` is one just set aside, which the state does not show yet. */
  const next = (skip?: number) => {
    setPicked(null)
    let p = pos + 1
    while (p < queue.length && (aside[queue[p]] || queue[p] === skip)) p++
    if (p < queue.length) setPos(p)
    else afterCards()
  }
  const choose = (i: number) => {
    if (!card || picked !== null || aside[card.id]) return
    setPicked(i)
    const right = i === card.answer
    if (first[card.id] === undefined) setFirst((f) => ({ ...f, [card.id]: right }))
    if (!right) setQueue((q) => [...q, card.id])  // until it is answered right
  }
  /** A card set aside is not asked again this session either: its later turn leaves the queue. */
  const setCardAside = (id: number, why: "known" | "disputed") => {
    setAside((a) => ({ ...a, [id]: why }))
    setQueue((q) => q.filter((x, j) => j <= pos || x !== id))
  }
  const know = () => { if (!card) return; setCardAside(card.id, "known"); next(card.id) }
  const dispute = () => { if (card) setCardAside(card.id, "disputed") }
  const nextChallenge = () => (ci + 1 < challenges.length ? setCi(ci + 1) : setView("done"))

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea")) return
    if (view === "overview" && e.key === "Enter") { e.preventDefault(); start() }
    if (view === "cards" && card) {
      if (/^[1-4]$/.test(e.key)) choose(Number(e.key) - 1)
      if (e.key === "Enter" && (picked !== null || aside[card.id])) { e.preventDefault(); next() }
    }
    if (view === "challenges" && challenge && e.key === "Enter" && decided[challenge.id]) { e.preventDefault(); nextChallenge() }
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  return (
    <>
      <GallerySidebar placement={placement} due={due} />
      <SidebarInset className="min-h-svh">
        {controls}
        <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
          {view === "overview" && (
            <Overview evening={evening} cards={cards} challenges={challenges} onStart={start} />
          )}
          {card && (
            <CardView card={card} pos={pos} total={queue.length} again={again} picked={picked} aside={aside[card.id]}
              onChoose={choose} onNext={() => next()} onKnow={know} onDispute={dispute} />
          )}
          {challenge && (
            <ChallengeView challenge={challenge} index={ci} total={challenges.length} decided={decided[challenge.id]}
              onDecide={(d) => setDecided((x) => ({ ...x, [challenge.id]: d }))} onNext={nextChallenge} />
          )}
          {view === "done" && (
            <Done cards={cards} first={first} aside={aside} challenges={challenges} decided={decided} waiting={waiting} evening={evening} />
          )}
        </main>
        <ToolbarMock />
      </SidebarInset>
    </>
  )
}

function GallerySidebar({ placement, due }: { placement: Placement; due: number }) {
  const session = (
    <SidebarMenuItem>
      <SidebarMenuButton isActive tooltip="Session"><IconCards /><span>Session</span></SidebarMenuButton>
      {due > 0 && <SidebarMenuBadge title="Cards and challenges left today">{due}</SidebarMenuBadge>}
      {/* folded to icons the badge is gone: a dot says something is waiting */}
      {due > 0 && <span aria-hidden className="pointer-events-none absolute top-1.5 left-6 hidden size-1.5 rounded-full bg-primary group-data-[collapsible=icon]:block" />}
    </SidebarMenuItem>
  )
  const stage = (label: string, Icon: typeof IconScan, progress?: string) => (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={label}><Icon /><span>{label}</span></SidebarMenuButton>
      {progress && <SidebarMenuBadge>{progress}</SidebarMenuBadge>}
    </SidebarMenuItem>
  )
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<div />} className="hover:bg-transparent active:bg-transparent">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"><IconBook className="size-4" /></div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">The Great Gatsby</span>
                <span className="truncate text-xs text-muted-foreground">F. Scott Fitzgerald · 9 chapters</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {stage("Review", IconScan, "18%")}
            {stage("Translate", IconLanguage, "4%")}
            {placement === "stages" && session}
            {stage("Export", IconFileExport)}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarMenu>
            {placement === "bottom" && session}
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Glossary"><IconBook2 /><span>Glossary</span></SidebarMenuButton>
              <SidebarMenuBadge title="Terms without a translation">3</SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

/** What tonight's run did, in one line above the session. */
function EveningLine({ evening }: { evening: Evening }) {
  const line: Record<Evening, ReactNode> = {
    ready: <><IconCheck className="size-4 text-mark-term-ink" />Made tonight at 21:00 from 12 changed paragraphs — 9 yours, 3 Claude's</>,
    making: <><IconLoader2 className="size-4 animate-spin" />Claude is making tonight's cards from 12 changed paragraphs…</>,
    failed: (
      <>
        <IconAlertTriangle className="size-4 text-destructive" />Tonight's cards could not be made: Claude could not be reached (tried 3 times).
        <Button size="xs" variant="outline" className="ml-1">Try again</Button>
      </>
    ),
    nothing: <>Nothing changed today, so there are no new cards tonight.</>,
  }
  return <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{line[evening]}</p>
}

function Overview({ evening, cards, challenges, onStart }: { evening: Evening; cards: Card[]; challenges: Challenge[]; onStart: () => void }) {
  const fresh = cards.filter((c) => c.isNew).length
  const counts = [[fresh, "new"], [cards.length - fresh, "to review"], [challenges.length, challenges.length === 1 ? "challenge" : "challenges"]] as const
  return (
    <div className="space-y-6">
      <EveningLine evening={evening} />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Tonight's session</h1>
        <p className="text-sm text-muted-foreground">{counts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`).join(" · ")}</p>
      </div>
      <Button onClick={onStart}>Start <Kbd className="bg-primary-foreground/20 text-primary-foreground">↵</Kbd></Button>
      <p className="max-w-md text-xs text-muted-foreground">
        A card comes back after 1, 2, 4, 8 and 16 days; right the fifth time, it is learned. A wrong answer comes back at the end of the
        session until you get it, and the next day the card starts over.
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">Learning 23 · Learned 4 · Set aside 2</p>
    </div>
  )
}

function CardView({ card, pos, total, again, picked, aside, onChoose, onNext, onKnow, onDispute }: {
  card: Card; pos: number; total: number; again: boolean; picked: number | null; aside?: "known" | "disputed"
  onChoose: (i: number) => void; onNext: () => void; onKnow: () => void; onDispute: () => void
}) {
  const answered = picked !== null
  const right = picked === card.answer
  const after = !right ? "Again at the end of this session until you get it; tomorrow it starts over from box 1"
    : again ? "Box 1 · tomorrow"
    : card.box === 5 ? "Learned — it won't come back"
    : `Box ${card.box} → ${card.box + 1} · back in ${INTERVAL[card.box + 1]} days`
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Progress value={Math.round((pos / total) * 100)} aria-label="Session progress" className="flex-1" />
        <span className="tabular-nums">{pos + 1} / {total}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">{card.kind === "meaning" ? "Meaning" : "Nuance"}</Badge>
        <span className="text-muted-foreground">{again ? "Once more" : card.isNew ? "New" : `Box ${card.box} of 5`}</span>
        <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground">¶{card.para} · Chapter I</Button>
      </div>
      <p className="reading text-[17px] leading-relaxed" lang="en"><Quoted text={card.sentence} quote={card.quote} /></p>
      <p className="text-sm font-medium">{card.question}</p>
      <ol className="space-y-1.5">
        {card.options.map((o, i) => (
          <li key={o}>
            <button type="button" onClick={() => onChoose(i)} disabled={answered}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default",
                !answered ? "hover:bg-muted" : i === card.answer ? "border-mark-term-ink/40 bg-mark-term/40" : i === picked ? "border-mark-warning-ink/40 bg-mark-warning/40" : "text-muted-foreground",
              )}>
              <Kbd>{i + 1}</Kbd>
              <span>{o}</span>
              {answered && i === card.answer && <IconCheck className="ml-auto size-4 text-mark-term-ink" />}
              {answered && i === picked && i !== card.answer && <IconX className="ml-auto size-4 text-mark-warning-ink" />}
            </button>
          </li>
        ))}
      </ol>
      {answered && (
        <div className="space-y-2 rounded-md bg-muted/50 px-3 py-2.5 text-sm">
          <p className="font-medium">{right ? "Right." : `Not this one — ${card.answer + 1} is right.`}</p>
          <p className="text-muted-foreground">{card.why}</p>
          <p className="pt-1 text-xs text-muted-foreground">¶{card.para} as translated now</p>
          <p className="reading text-[15px]" lang="ko">{PARAS[card.para].ko}</p>
          <p className="pt-1 text-xs text-muted-foreground">{aside === "disputed" ? "Set aside — this card won't come back." : after}</p>
        </div>
      )}
      <footer className="flex items-center gap-1">
        {!aside && <Button size="sm" variant="ghost" onClick={onKnow}>I know this</Button>}
        {answered && !aside && <Button size="sm" variant="ghost" onClick={onDispute}>Answer looks wrong</Button>}
        {aside === "disputed" && <Button size="sm" variant="outline"><IconMessage />Discuss with Claude</Button>}
        {answered && <Button size="sm" className="ml-auto" onClick={onNext}>Next <Kbd className="bg-primary-foreground/20 text-primary-foreground">↵</Kbd></Button>}
      </footer>
    </div>
  )
}

function ChallengeView({ challenge: ch, index, total, decided, onDecide, onNext }: {
  challenge: Challenge; index: number; total: number; decided?: "kept" | "changed" | "discuss"; onDecide: (d: "kept" | "changed" | "discuss") => void; onNext: () => void
}) {
  const p = PARAS[ch.para]
  const ko = decided === "changed" ? p.ko.replace(ch.quote, ch.proposal) : p.ko
  const outcome = { kept: "Kept as it is.", changed: `¶${ch.para} changed — ⌘Z in the editor undoes it.`, discuss: "Opened in the Claude panel, with this challenge as the first message." }
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground tabular-nums">Challenge {index + 1} of {total}</p>
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">Challenge</Badge>
        <span className="text-muted-foreground">{ch.by === "agent" ? "Claude's translation" : "Your translation"}</span>
        <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground">¶{ch.para} · Chapter I</Button>
      </div>
      <p className="reading text-[15px] text-muted-foreground" lang="en">{p.en}</p>
      <p className="reading text-[17px] leading-relaxed" lang="ko">
        {decided === "changed" ? ko : <Proposed text={ko} quote={ch.quote} proposal={ch.proposal} />}
      </p>
      <div className="space-y-1.5 text-sm">
        <p className="font-medium">{ch.question}</p>
        <p className="text-muted-foreground">{ch.why}</p>
      </div>
      {decided ? (
        <footer className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{outcome[decided]}</span>
          <Button size="sm" className="ml-auto" onClick={onNext}>Next <Kbd className="bg-primary-foreground/20 text-primary-foreground">↵</Kbd></Button>
        </footer>
      ) : (
        <footer className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => onDecide("kept")}>Keep it</Button>
          <Button size="sm" variant="outline" onClick={() => onDecide("changed")}>Use the suggestion</Button>
          <Button size="sm" variant="ghost" onClick={() => onDecide("discuss")}><IconMessage />Discuss with Claude</Button>
        </footer>
      )}
    </div>
  )
}

function Done({ cards, first, aside, challenges, decided, waiting, evening }: {
  cards: Card[]; first: Record<number, boolean>; aside: Record<number, "known" | "disputed">; challenges: Challenge[]
  decided: Record<number, "kept" | "changed" | "discuss">; waiting: boolean; evening: Evening
}) {
  const [more, setMore] = useState<string | null>(null)
  const answered = cards.filter((c) => first[c.id] !== undefined && !aside[c.id])
  const right = answered.filter((c) => first[c.id]).length
  const known = Object.values(aside).filter((a) => a === "known").length
  const disputed = Object.values(aside).filter((a) => a === "disputed").length
  const count = (d: "kept" | "changed" | "discuss") => Object.values(decided).filter((x) => x === d).length
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Session done</h1>
        <ul className="space-y-0.5 text-sm text-muted-foreground">
          <li>{answered.length} cards — {right} right the first time, {answered.length - right} back tomorrow</li>
          {known > 0 && <li>{known} set aside as known</li>}
          {disputed > 0 && <li>{disputed} set aside as a wrong answer</li>}
          {challenges.length > 0 && <li>Challenges — {count("kept")} kept, {count("changed")} changed, {count("discuss")} to discuss</li>}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {waiting ? (
          <>
            <Button variant="outline" onClick={() => setMore("The next 8 cards would follow.")}>10 more <span className="text-muted-foreground">· 8 waiting</span></Button>
            {evening === "ready" && <Button variant="outline" onClick={() => setMore("The next challenge would follow.")}>3 more challenges <span className="text-muted-foreground">· 1 waiting</span></Button>}
          </>
        ) : (
          <Button variant="outline" onClick={() => setMore("Claude makes them now, from paragraphs changed in the last 7 days that have no cards yet.")}>
            <IconSparkles />Make more from the last 7 days
          </Button>
        )}
      </div>
      {more && <p className="text-xs text-muted-foreground">(갤러리) {more}</p>}
      <p className="text-xs text-muted-foreground">New cards tomorrow at 21:00, from what changes until then.</p>
    </div>
  )
}

/** The English with the quizzed words underlined. */
function Quoted({ text, quote }: { text: string; quote: string }) {
  const i = text.indexOf(quote)
  if (i === -1) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="bg-transparent text-inherit underline decoration-primary/60 decoration-2 underline-offset-4">{quote}</mark>{text.slice(i + quote.length)}</>
}

/** The translation with Claude's alternative, in the suggestions' diff language: struck on a warning tint, the new words in green. */
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

/** The selection toolbar with the one button Session adds. */
function ToolbarMock() {
  return (
    <section className="mx-auto w-full max-w-2xl space-y-2 border-t px-6 py-6">
      <p className="text-xs font-medium text-muted-foreground">툴바 · 원문에서 고른 말을 Session에 넣는다 (원문 구절로 Ask Claude를 누르면 자동으로 들어간다)</p>
      <div className="relative pt-10">
        <div className="absolute top-0 left-24 flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md">
          <Button size="xs" variant="ghost">Comment</Button>
          <Button size="xs" variant="ghost">Ask Claude</Button>
          <Button size="xs" variant="ghost" className="bg-muted"><IconCards />Add to Session</Button>
        </div>
        <p className="reading text-[15px]" lang="en">
          …made me the victim of not a few <span className="bg-primary/15">veteran bores</span>.
        </p>
      </div>
    </section>
  )
}

function Choice<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <ToggleGroup value={[value]} onValueChange={(v) => v[0] && onChange(v[0] as T)} size="sm" variant="outline" spacing={0}>
        {items.map(([v, l]) => <ToggleGroupItem key={v} value={v}>{l}</ToggleGroupItem>)}
      </ToggleGroup>
    </div>
  )
}
