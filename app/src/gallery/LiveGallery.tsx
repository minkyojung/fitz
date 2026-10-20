import { useEffect, useState } from "react"
import { IconBook, IconPlayerPlay } from "@tabler/icons-react"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle,
} from "@/components/ui/trace"
import { doingLine } from "@/lib/trace"
import { cn } from "cn"

/** ?gallery&live — what Claude's panel shows from the translator's Enter to Claude's first thought, and on. The same
 *  turn played twice: as the panel draws it now (a gap between "Starting" and the first finished thought), and as one
 *  live line that stays from Enter to the answer. The pixel loader is the reference's (Drive, Dots, Orbit). */

// --- the pixel loader: a 3×3 grid, each cell lit after a delay set by where it is

const CHEVRON = Array.from({ length: 9 }, (_, i) => ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90)  // a ">" moving right
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3]
const ORBIT = Array.from({ length: 9 }, (_, i) => { const k = ORBIT_ORDER.indexOf(i); return k === -1 ? null : k * 110 })
const LOADERS = {
  drive: { delays: CHEVRON, round: false, run: "animate-[pixel-on_650ms_ease-in-out_infinite]" },
  dots: { delays: CHEVRON, round: true, run: "animate-[pixel-on_650ms_ease-in-out_infinite]" },
  orbit: { delays: ORBIT, round: false, run: "animate-[pixel-on_950ms_ease-in-out_infinite]" },
} as const
type Loader = keyof typeof LOADERS | "none"

function PixelLoader({ kind }: { kind: keyof typeof LOADERS }) {
  const { delays, round, run } = LOADERS[kind]
  return (
    <span aria-hidden className="grid grid-cols-[repeat(3,4px)] gap-px">
      {delays.map((d, i) => (
        <span key={i} style={d === null ? undefined : ({ "--d": `${d}ms` } as React.CSSProperties)}
          className={cn("size-1 bg-current", round ? "rounded-full" : "rounded-[1px]",
            d === null ? "opacity-10" : cn("opacity-20 [animation-delay:var(--d)] motion-reduce:animate-none", run))} />
      ))}
    </span>
  )
}

/** Seconds since `since`, a tenth at a time; the figures keep their width. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t) }, [])
  const s = Math.max(0, now - since) / 1000
  return <TraceDescription aria-hidden>{s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s`}</TraceDescription>
}

// --- one turn, played: when each thing happens (ms after Enter)

const T = { echo: 700, think: 2500, thought: 5000, read: 5300, readDone: 6800, words: 7200, end: 10200 }
const QUESTION = "¶36의 'unusually communicative in a reserved way'는 어떤 뉘앙스야?"
const THOUGHT = "번역가는 ¶36의 'unusually communicative in a reserved way'를 묻는다. 이 인물은 앞에서 말수가 적은 사람으로 그려졌다. reserved는 성격을, unusually communicative는 그날의 예외를 말하는 듯하다. ¶35와 ¶37을 먼저 읽고 정하자."
const ANSWER = "평소 말수가 적은 사람이 그날만은 드물게 말을 많이 했다는 뜻이에요. 다만 'in a reserved way'가 붙어, 말은 많아도 속을 다 드러내지는 않는 태도가 남아 있어요. ‘조심스러우면서도 유난히 말이 많았다’ 정도가 맞아요."

type Phase = "sent" | "echoed" | "thinking" | "between" | "reading" | "between2" | "writing" | "done"
function phaseAt(t: number): Phase {
  if (t < T.echo) return "sent"
  if (t < T.think) return "echoed"
  if (t < T.thought) return "thinking"
  if (t < T.read) return "between"
  if (t < T.readDone) return "reading"
  if (t < T.words) return "between2"
  if (t < T.end) return "writing"
  return "done"
}
const part = (text: string, t: number, from: number, to: number) => text.slice(0, Math.round(text.length * Math.min(1, Math.max(0, (t - from) / (to - from)))))

function usePlay() {
  const [start, setStart] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (start === null) return
    const t = setInterval(() => setNow(Date.now()), 50)
    return () => clearInterval(t)
  }, [start])
  const t = start === null ? T.end + 1 : now - start
  return { t, start, play: () => { const n = Date.now(); setStart(n); setNow(n) } }
}

export function LiveGallery() {
  const { t, start, play } = usePlay()
  const [loader, setLoader] = useState<Loader>("drive")
  const [elapsed, setElapsed] = useState(true)
  const [stream, setStream] = useState(true)
  const phase = phaseAt(t)
  return (
    <div className="min-h-svh bg-background p-8 text-foreground">
      <h1 className="text-lg font-semibold">엔터에서 첫 생각까지: Claude 패널의 진행 줄</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        같은 턴을 두 번 재생한다. 지금은 메시지가 되돌아오면 “Starting”이 사라지고, 첫 생각이 끝날 때까지 아무것도 없다.
        제안은 줄 하나가 엔터부터 답이 나올 때까지 그 자리에 있고 글자만 바뀐다(Starting → Thinking → Reading → …).
        폭은 Claude 패널과 비슷한 300px.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-6 text-sm">
        <Button size="sm" onClick={play}><IconPlayerPlay data-icon="inline-start" />재생</Button>
        <span className="tabular-nums text-muted-foreground">{start === null ? "멈춤" : `${(Math.min(t, T.end) / 1000).toFixed(1)}s · ${phase}`}</span>
        <label className="flex items-center gap-2">
          로더
          <ToggleGroup value={[loader]} onValueChange={(v: string[]) => v[0] && setLoader(v[0] as Loader)} variant="outline" size="sm">
            {(["drive", "dots", "orbit", "none"] as const).map((k) => (
              <ToggleGroupItem key={k} value={k}>{k === "none" ? "없음" : k[0].toUpperCase() + k.slice(1)}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </label>
        <label className="flex items-center gap-2"><Checkbox checked={elapsed} onCheckedChange={(v) => setElapsed(v === true)} />경과 시간</label>
        <label className="flex items-center gap-2"><Checkbox checked={stream} onCheckedChange={(v) => setStream(v === true)} />생각을 흘러나오는 대로</label>
      </div>

      <div className="mt-6 flex flex-wrap gap-10">
        <Panel title="지금" note="되돌아온 뒤 첫 생각이 끝날 때까지 비어 있다">
          <Now t={t} phase={phase} />
        </Panel>
        <Panel title="제안" note="줄 하나가 엔터부터 이어진다">
          <Proposed t={t} phase={phase} since={start ?? 0} loader={loader} elapsed={elapsed} stream={stream} />
        </Panel>
      </div>

      <h2 className="mt-12 text-sm font-medium">단계마다 · 로더마다</h2>
      <div className="mt-3 grid w-fit grid-cols-[auto_repeat(4,180px)] items-center gap-x-6 gap-y-3 text-xs">
        <span />
        {(["drive", "dots", "orbit", "none"] as const).map((k) => <span key={k} className="text-muted-foreground">{k === "none" ? "없음(지금의 반짝임만)" : k}</span>)}
        {["Starting", "Thinking", doingLine("read"), "Waiting for your answer"].map((label) => (
          <Row key={label} label={label} />
        ))}
      </div>
    </div>
  )
}

function Row({ label }: { label: string }) {
  const [since] = useState(() => Date.now() - 4200)
  const waiting = label.startsWith("Waiting")
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      {(["drive", "dots", "orbit", "none"] as const).map((k) => (
        <Trace key={k}>
          <TraceLine status={waiting ? undefined : "running"}>
            {k !== "none" && !waiting && <TraceIcon><PixelLoader kind={k} /></TraceIcon>}
            <TraceTitle>{label}</TraceTitle>
            {!waiting && <Elapsed since={since} />}
          </TraceLine>
        </Trace>
      ))}
    </>
  )
}

function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="w-[300px]">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs/relaxed text-muted-foreground">{note}</p>
      <div className="mt-3 flex h-[420px] flex-col gap-5 overflow-hidden rounded-md border p-3">{children}</div>
    </section>
  )
}

function Question() {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end" variant="muted">
          <BubbleContent className="text-sm/relaxed"><p lang="ko">{QUESTION}</p></BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function Thought() {
  const [open, setOpen] = useState(false)
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger><TraceLine><TraceTitle>Thought</TraceTitle></TraceLine></TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{THOUGHT}</TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function ReadLine({ running }: { running: boolean }) {
  return (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon><IconBook /></TraceIcon>
      <TraceTitle>Read ¶35–37</TraceTitle>
    </TraceLine>
  )
}

const Words = ({ text }: { text: string }) => <p lang="ko" className="text-sm/relaxed">{text}</p>
const End = () => <MessageFooter className="gap-1 px-0 text-xs font-normal">10s</MessageFooter>

/** The panel as it is: "Starting" until the echo; Claude's side only once it has a finished item. */
function Now({ t, phase }: { t: number; phase: Phase }) {
  const claude = !["sent", "echoed", "thinking"].includes(phase)
  return (
    <>
      <Question />
      {phase === "sent" && <Trace><TraceLine status="running"><TraceTitle>Starting</TraceTitle></TraceLine></Trace>}
      {claude && (
        <Message>
          <MessageContent className="gap-3">
            <Trace>
              <Thought />
              {phase !== "between" && <ReadLine running={phase === "reading"} />}
            </Trace>
            {(phase === "writing" || phase === "done") && <Words text={phase === "done" ? ANSWER : part(ANSWER, t, T.words, T.end)} />}
            {(phase === "between" || phase === "reading" || phase === "between2") && (
              <Trace><TraceLine status="running"><TraceTitle>{phase === "reading" ? doingLine("read") : "Working"}</TraceTitle></TraceLine></Trace>
            )}
            {phase === "done" && <End />}
          </MessageContent>
        </Message>
      )}
    </>
  )
}

/** One live line from Enter to the answer: the same element throughout, its words following the turn. */
function Proposed({ t, phase, since, loader, elapsed, stream }: {
  t: number; phase: Phase; since: number; loader: Loader; elapsed: boolean; stream: boolean
}) {
  const live = phase !== "writing" && phase !== "done"
  const label = phase === "sent" ? "Starting" : phase === "reading" ? doingLine("read") : phase === "between" || phase === "between2" ? "Working" : "Thinking"
  const thought = !["sent", "echoed", "thinking"].includes(phase)
  return (
    <>
      <Question />
      <Message>
        <MessageContent className="gap-3">
          {thought && (
            <Trace>
              <Thought />
              {phase !== "between" && <ReadLine running={phase === "reading"} />}
            </Trace>
          )}
          {(phase === "writing" || phase === "done") && <Words text={phase === "done" ? ANSWER : part(ANSWER, t, T.words, T.end)} />}
          {live && (
            <Trace role="status">
              <TraceLine status="running">
                {loader !== "none" && <TraceIcon><PixelLoader kind={loader} /></TraceIcon>}
                <TraceTitle>{label}</TraceTitle>
                {elapsed && <Elapsed since={since} />}
              </TraceLine>
              {stream && phase === "thinking" && (
                // its last four lines: the newest words stay in sight, the oldest go out at the top
                <div className="flex max-h-[4lh] flex-col justify-end overflow-hidden border-l pl-2 text-xs/relaxed text-muted-foreground">
                  <p lang="ko">{part(THOUGHT + " " + THOUGHT, t, T.think, T.thought)}</p>
                </div>
              )}
            </Trace>
          )}
          {phase === "done" && <End />}
        </MessageContent>
      </Message>
    </>
  )
}
