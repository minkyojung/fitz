import { useState } from "react"
import { IconArrowBackUp, IconArrowForwardUp, IconBook, IconPencil } from "@tabler/icons-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace"
import { cn } from "cn"

// Design check for docs/agent.md §18.1 row 0 before it is built: two writers, two ways back. ⌘Z undoes only the
// translator's own changes; Claude's are undone from the conversation, from a chosen point on (as Claude Code's
// /rewind), and not at all if the translator changed the same thing afterwards. Sample text: The Great Gatsby.

const EN = {
  3: "“Whenever you feel like criticizing any one,” he told me, “just remember that all the people in this world haven't had the advantages that you've had.”",
  4: "He didn't say any more, but we've always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that.",
}
const KO = {
  w1: "“누군가를 비판하고 싶어질 때면,” 아버지는 내게 말씀하셨다. “이 세상 모든 사람이 다 너처럼 좋은 조건을 누린 건 아니라는 걸 기억하렴.”",
  w2: "아버지는 더 말씀하지 않으셨지만, 우리 부자는 늘 말을 아끼면서도 유난히 잘 통하는 사이였기에, 나는 그 말에 훨씬 더 많은 뜻이 담겨 있음을 알았다.",
  w3: "아버지는 더 말이 없었지만, 우리는 말을 아끼면서도 잘 통했기에 나는 그 말의 깊은 뜻을 알았다.",
  mine: "아버지는 더 말이 없었지만, 우리는 말수 적은 채로 잘 통했고 나는 그 말의 깊은 뜻을 알았다.",
}

/** Claude's writes in the conversation, in order: which turn, which paragraph. */
const WRITES = [
  { id: 1, turn: 1, para: 3 as const },
  { id: 2, turn: 1, para: 4 as const },
  { id: 3, turn: 2, para: 4 as const },
]

export function UndoGallery() {
  const [afterwards, setAfterwards] = useState(false)
  return (
    <div className="space-y-8 p-6">
      <div className="space-y-1">
        <h1 className="text-xs font-medium text-muted-foreground">되돌리기 갤러리 · ⌘Z는 번역자 것만 · Claude가 한 것은 대화에서, 고른 곳부터 (Claude Code의 rewind처럼)</h1>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={afterwards} onCheckedChange={(v) => setAfterwards(v === true)} />
          그 뒤 번역자가 ¶4를 직접 고쳤다면 (되돌리기가 거절되는 경우 보기)
        </label>
      </div>
      <Frame layout="line" afterwards={afterwards} />
      <Frame layout="turn" afterwards={afterwards} />
      <UndoKey />
    </div>
  )
}

/** One editor: the two paragraphs and the conversation that wrote them. */
function Frame({ layout, afterwards }: { layout: "line" | "turn"; afterwards: boolean }) {
  const [undone, setUndone] = useState<Set<number>>(new Set())
  const [hoverFrom, setHoverFrom] = useState<number | null>(null)
  const [refused, setRefused] = useState<{ at: number; text: string } | null>(null)
  const live = (id: number) => !undone.has(id)
  const ko3 = live(1) ? KO.w1 : ""
  const ko4 = afterwards ? KO.mine : live(3) ? KO.w3 : live(2) ? KO.w2 : ""
  /** From this write on, newest first; nothing if the translator changed any of it afterwards. */
  const undoFrom = (index: number) => {
    const these = WRITES.slice(index).filter((w) => live(w.id))
    if (afterwards && these.some((w) => w.para === 4)) {
      setRefused({ at: index, text: "Not undone: you changed ¶4 after Claude. Undo your change first (⌘Z), or keep it." })
      return
    }
    setRefused(null)
    setUndone((u) => new Set([...u, ...these.map((w) => w.id)]))
  }
  const firstOfTurn = (turn: number) => WRITES.findIndex((w) => w.turn === turn)
  const liveInTurnAndAfter = (turn: number) => WRITES.slice(firstOfTurn(turn)).filter((w) => live(w.id)).length

  return (
    <section className="space-y-1.5">
      <p className="text-xs font-medium">
        {layout === "line" ? "A안 · 쓰기 줄마다 Undo — 누르면 그 줄부터 끝까지(마우스를 올리면 함께 되돌아갈 줄이 표시됨)" : "B안 · 턴 끝에 Undo — 누르면 그 턴부터 끝까지"}
        <Button size="xs" variant="ghost" className="ml-2" onClick={() => { setUndone(new Set()); setRefused(null) }}>처음으로</Button>
      </p>
      <div className="flex h-[520px] overflow-hidden rounded-md border text-sm" style={{ width: 1160 }}>
        <main className="min-w-0 flex-1 space-y-6 overflow-auto p-6">
          {([3, 4] as const).map((n) => (
            <div key={n} className="grid grid-cols-2 gap-6">
              <p className="reading text-[15px] text-muted-foreground" lang="en">{EN[n]}</p>
              <p className={cn("reading text-[15px]", !(n === 3 ? ko3 : ko4) && "text-muted-foreground/50")} lang="ko">
                {(n === 3 ? ko3 : ko4) || "Translate…"}
                {n === 4 && afterwards && <Badge variant="outline" className="ml-2 align-middle">you edited</Badge>}
              </p>
            </div>
          ))}
        </main>
        <aside className="flex w-[320px] shrink-0 flex-col gap-5 overflow-auto border-l p-3">
          <You text="¶3, ¶4를 번역해서 넣어줘" />
          <Claude
            lines={[{ read: "Read ¶3 and 3 around" }, { write: 0 }, { write: 1 }]}
            words="¶3, ¶4 번역을 초안으로 넣었습니다."
            end="9s · $0.041"
            layout={layout} undone={undone} hoverFrom={hoverFrom} setHoverFrom={setHoverFrom} undoFrom={undoFrom}
            turnCount={liveInTurnAndAfter(1)} firstOfTurn={firstOfTurn(1)} refused={refused}
          />
          <You text="¶4는 좀 더 짧게" />
          <Claude
            lines={[{ write: 2 }]}
            words="¶4를 줄였습니다."
            end="4s · $0.012"
            layout={layout} undone={undone} hoverFrom={hoverFrom} setHoverFrom={setHoverFrom} undoFrom={undoFrom}
            turnCount={liveInTurnAndAfter(2)} firstOfTurn={firstOfTurn(2)} refused={refused}
          />
        </aside>
      </div>
    </section>
  )
}

function You({ text }: { text: string }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end" variant="muted"><BubbleContent className="text-[13px]" lang="ko">{text}</BubbleContent></Bubble>
      </MessageContent>
    </Message>
  )
}

function Claude({ lines, words, end, layout, undone, hoverFrom, setHoverFrom, undoFrom, turnCount, firstOfTurn, refused }: {
  lines: ({ read: string } | { write: number })[]; words: string; end: string; layout: "line" | "turn"
  undone: Set<number>; hoverFrom: number | null; setHoverFrom: (i: number | null) => void; undoFrom: (i: number) => void
  turnCount: number; firstOfTurn: number; refused: { at: number; text: string } | null
}) {
  const marked = (i: number) => hoverFrom !== null && i >= hoverFrom && !undone.has(WRITES[i].id)
  return (
    <Message>
      <MessageContent className="gap-3">
        <Trace>
          {lines.map((l, k) => {
            if ("read" in l) return <TraceLine key={k}><TraceIcon><IconBook /></TraceIcon><TraceTitle>{l.read}</TraceTitle></TraceLine>
            const w = WRITES[l.write]
            const gone = undone.has(w.id)
            return (
              <div key={k} className="space-y-1">
                <div className={cn("group/line -mx-1 flex items-center gap-1 rounded px-1 transition-colors", marked(l.write) && "bg-mark-warning/30")}>
                  <TraceLine className={cn(gone && "line-through opacity-60")}>
                    <TraceIcon><IconPencil /></TraceIcon>
                    <TraceTitle>Wrote the translation of ¶{w.para}</TraceTitle>
                    {gone && <TraceDescription className="no-underline">undone</TraceDescription>}
                  </TraceLine>
                  {layout === "line" && !gone && (
                    <Button size="xs" variant="ghost" className="ml-auto h-5 px-1.5 text-muted-foreground opacity-0 transition-opacity group-hover/line:opacity-100"
                      onMouseEnter={() => setHoverFrom(l.write)} onMouseLeave={() => setHoverFrom(null)} onClick={() => undoFrom(l.write)}>
                      <IconArrowBackUp data-icon="inline-start" />Undo
                    </Button>
                  )}
                </div>
                {layout === "line" && refused?.at === l.write && <p className="text-xs text-destructive">{refused.text}</p>}
              </div>
            )
          })}
        </Trace>
        <p className="text-[13px]" lang="ko">{words}</p>
        <MessageFooter className="gap-2 px-0">
          {end}
          {layout === "turn" && turnCount > 0 && (
            <Button size="xs" variant="ghost" className="h-5 px-1.5 text-muted-foreground"
              onMouseEnter={() => setHoverFrom(firstOfTurn)} onMouseLeave={() => setHoverFrom(null)} onClick={() => undoFrom(firstOfTurn)}>
              <IconArrowBackUp data-icon="inline-start" />Undo from here ({turnCount})
            </Button>
          )}
        </MessageFooter>
        {layout === "turn" && refused?.at === firstOfTurn && <p className="text-xs text-destructive">{refused.text}</p>}
      </MessageContent>
    </Message>
  )
}

/** ⌘Z on a history both wrote: it takes back the translator's own, passes over Claude's, and refuses when Claude
 *  changed the same thing afterwards. */
function UndoKey() {
  const [claudeAfterOnSame, setClaudeAfterOnSame] = useState(false)
  const [notice, setNotice] = useState(false)
  const ops = [
    { id: 1, who: "you", what: "Edit ¶2", touches: "¶2" },
    { id: 2, who: "Claude", what: claudeAfterOnSame ? "Wrote ¶2" : "Wrote ¶3", touches: claudeAfterOnSame ? "¶2" : "¶3" },
    { id: 3, who: "you", what: "Comment on ¶5", touches: "comment ¶5" },
    { id: 4, who: "Claude", what: "Wrote ¶6", touches: "¶6" },
  ]
  const [undone, setUndone] = useState<number[]>([])
  const mineLeft = ops.filter((o) => o.who === "you" && !undone.includes(o.id))
  const undo = () => {
    const op = mineLeft.at(-1)
    if (!op) { toast("Nothing of yours to undo"); return }
    const later = ops.find((o) => o.id > op.id && o.who === "Claude" && o.touches === op.touches)
    if (later) { toast.warning("Can't undo", { description: `Claude changed ${op.touches} after your edit. Undo Claude's change in the conversation first.` }); return }
    const skipped = ops.some((o) => o.id > op.id && o.who === "Claude")
    setUndone((u) => [...u, op.id])
    toast("Undone", { description: op.what + (notice && skipped ? " · Claude's later changes stay as they are" : "") })
  }
  const redo = () => {
    const last = undone.at(-1)
    if (last === undefined) { toast("Nothing to redo"); return }
    setUndone((u) => u.slice(0, -1))
    toast("Redone", { description: ops.find((o) => o.id === last)!.what })
  }
  return (
    <section className="space-y-2">
      <p className="text-xs font-medium">⌘Z · 두 쪽이 섞인 기록에서 번역자의 ⌘Z (아래 버튼이 ⌘Z / ⌘⇧Z, 오른쪽 아래에 알림)</p>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2"><Checkbox checked={claudeAfterOnSame} onCheckedChange={(v) => { setClaudeAfterOnSame(v === true); setUndone([]) }} />Claude가 그 뒤 같은 ¶2를 고쳤다면</label>
        <label className="flex items-center gap-2"><Checkbox checked={notice} onCheckedChange={(v) => setNotice(v === true)} />Claude의 변경을 건너뛰었다고 알리기</label>
        <Button size="xs" variant="outline" onClick={undo}><IconArrowBackUp data-icon="inline-start" />⌘Z</Button>
        <Button size="xs" variant="outline" onClick={redo}><IconArrowForwardUp data-icon="inline-start" />⌘⇧Z</Button>
        <Button size="xs" variant="ghost" onClick={() => setUndone([])}>처음으로</Button>
      </div>
      <ol className="w-96 divide-y rounded-md border text-xs">
        {ops.map((o) => (
          <li key={o.id} className={cn("flex items-center gap-2 px-3 py-1.5", undone.includes(o.id) && "text-muted-foreground line-through")}>
            <span className="w-4 tabular-nums text-muted-foreground">{o.id}</span>
            {o.who === "Claude" ? <Badge variant="secondary">Claude</Badge> : <Badge variant="outline">You</Badge>}
            <span>{o.what}</span>
            {undone.includes(o.id) && <span className="ml-auto no-underline">undone</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}
