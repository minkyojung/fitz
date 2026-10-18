import { useState } from "react"
import { IconArrowUp, IconBook, IconCheck, IconChevronDown, IconChevronRight, IconMessage, IconNote, IconPlus, IconSparkles, IconX } from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { DiffView } from "@/features/review/DiffView"
import { cn } from "cn"

// Design check for docs/agent.md step 9 before it is built: talking with Claude inside the editor. No new column —
// Claude is called from the text (the selection toolbar's Ask Claude, ⌘L), talks in the right panel, and what it
// changes lands back in the text. Two ways to fit it in the panel: A adds a Claude tab beside Suggestions; B makes
// Suggestions part of a Claude tab. Sample text: The Great Gatsby (public domain).

const EN = "He didn't say any more, but we've always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that. In consequence, I'm inclined to reserve all judgments, a habit that has opened up many curious natures to me."
const KO = "아버지는 더 말씀하지 않으셨지만, 우리 부자는 늘 말을 아끼면서도 유난히 잘 통하는 사이였다. 그래서 나는 모든 판단을 유보하는 버릇이 생겼는데, 그 버릇 덕분에 별난 사람들이 내게 마음을 열었다."
const KO_AFTER = KO.replace("모든 판단을 유보하는", "섣불리 판단하지 않는")
const QUOTE = "reserve all judgments"
const PREV = { en: "In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since.", ko: "지금보다 어리고 쉽게 상처받던 시절, 아버지가 내게 해 주신 충고가 있는데 나는 그 뒤로 줄곧 그 말을 곱씹어 왔다." }

type Layout = "A" | "B"

export function AgentGallery() {
  const [width, setWidth] = useState(230)
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xs font-medium text-muted-foreground">
        Claude 대화 갤러리 · 새 열 없이: 본문에서 부르고(구절 선택 → Ask Claude, ⌘L) 오른쪽 패널에서 대화하고 바뀐 것은 본문으로
      </h1>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">패널 폭</span>
        {[230, 320].map((w) => (
          <Button key={w} size="xs" variant={width === w ? "default" : "outline"} onClick={() => setWidth(w)}>
            {w}px{w === 230 ? " (지금 기본, 20%)" : " (Claude 탭일 때 넓힌다면)"}
          </Button>
        ))}
      </div>
      <Frame layout="A" width={width} />
      <Frame layout="B" width={width} />
    </div>
  )
}

/** One editor at its real size: the translation in the middle, the panel on the right. */
function Frame({ layout, width }: { layout: Layout; width: number }) {
  const [tab, setTab] = useState("claude")
  const [attached, setAttached] = useState<string | null>(null)
  const [toolbar, setToolbar] = useState(true)
  const [decision, setDecision] = useState<"allow" | "deny" | null>(null)
  const ask = () => { setAttached(QUOTE); setTab("claude"); setToolbar(false) }
  const tabs = layout === "A" ? ["History", "Find", "Glossary", "Notes", "Suggestions", "Claude"] : ["History", "Find", "Glossary", "Notes", "Claude"]
  return (
    <section className="space-y-1.5">
      <p className="text-xs font-medium">
        {layout === "A" ? "A안 · 탭을 하나 더한다 (Suggestions 옆에 Claude)" : "B안 · Suggestions를 Claude 탭 안으로 (위는 이 장의 제안, 아래는 대화)"}
      </p>
      <div className="flex h-[620px] overflow-hidden rounded-md border text-sm" style={{ width: 1160 }}>
        <main className="min-w-0 flex-1 space-y-6 overflow-auto p-6">
          <Pair en={PREV.en} ko={PREV.ko} />
          <div className="grid grid-cols-2 gap-6">
            <p className="reading relative text-[15px] text-muted-foreground" lang="en">
              {EN.slice(0, EN.indexOf(QUOTE))}
              <span className="relative">
                {toolbar && <Toolbar onAsk={ask} onClose={() => setToolbar(false)} />}
                <span className={cn(toolbar && "bg-blue-200/60 dark:bg-blue-500/30")}>{QUOTE}</span>
              </span>
              {EN.slice(EN.indexOf(QUOTE) + QUOTE.length)}
            </p>
            <p className="reading text-[15px]" lang="ko">{decision === "allow" ? KO_AFTER : KO}</p>
          </div>
          {!toolbar && <Button size="xs" variant="outline" onClick={() => setToolbar(true)}>구절 선택 다시 보기</Button>}
        </main>
        <aside className="flex shrink-0 flex-col border-l" style={{ width }}>
          <div className="m-2 flex flex-wrap gap-0.5 self-start rounded-lg bg-muted p-[3px]">
            {tabs.map((t) => (
              <button key={t} onClick={() => setTab(t.toLowerCase())}
                className={cn("h-[26px] flex-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap text-foreground/60", tab === t.toLowerCase() && "bg-background text-foreground")}>
                {t === "Claude" && <IconSparkles className="mr-0.5 inline size-3.5" />}{t}
                {t === "Notes" && <Badge variant="destructive" className="ml-1">5</Badge>}
                {t === "Suggestions" && <Badge variant="secondary" className="ml-1">2</Badge>}
              </button>
            ))}
          </div>
          {tab === "claude" ? (
            <div className="flex min-h-0 flex-1 flex-col border-t">
              {layout === "B" && <SuggestionsSection />}
              <Chat attached={attached} onDetach={() => setAttached(null)} decision={decision} onDecide={setDecision} />
            </div>
          ) : tab === "suggestions" ? (
            <div className="border-t"><SuggestionList /></div>
          ) : (
            <p className="border-t p-3 text-xs text-muted-foreground">{tab} 탭 (그대로)</p>
          )}
        </aside>
      </div>
    </section>
  )
}

function Pair({ en, ko }: { en: string; ko: string }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <p className="reading text-[15px] text-muted-foreground" lang="en">{en}</p>
      <p className="reading text-[15px]" lang="ko">{ko}</p>
    </div>
  )
}

/** The selection toolbar the editor already has (Comment, Translator's note), with Ask Claude added. */
function Toolbar({ onAsk, onClose }: { onAsk: () => void; onClose: () => void }) {
  return (
    <span className="absolute bottom-full left-0 z-10 mb-1 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 font-sans shadow-md" onMouseDown={(e) => e.preventDefault()}>
      <Button size="xs" variant="ghost"><IconMessage data-icon="inline-start" />Comment</Button>
      <Button size="xs" variant="ghost"><IconNote data-icon="inline-start" />Translator's note</Button>
      <Button size="xs" variant="ghost" onClick={onAsk}><IconSparkles data-icon="inline-start" />Ask Claude <kbd className="ml-1 text-[10px] text-muted-foreground">⌘L</kbd></Button>
      <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={onClose}><IconX /></Button>
    </span>
  )
}

/** B: this chapter's suggestions on top of the conversation, folded to one line until opened. */
function SuggestionsSection() {
  const [open, setOpen] = useState(false)
  return (
    <div className="shrink-0 border-b">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-3 py-2 text-xs">
        {open ? <IconChevronDown className="size-3.5" /> : <IconChevronRight className="size-3.5" />}
        <span className="font-medium">Suggestions</span>
        <Badge variant="secondary">2 open</Badge>
      </button>
      {open && <div className="max-h-56 overflow-auto border-t"><SuggestionList /></div>}
    </div>
  )
}

/** The Suggestions tab as built (step 7), shortened. */
function SuggestionList() {
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <Button size="xs" variant="outline"><IconSparkles data-icon="inline-start" />Review this chapter with Claude</Button>
      </div>
      {[["모든 판단을 유보하는", "섣불리 판단하지 않는", "medium"], ["말을 아끼면서도", "말수는 적어도", "low"]].map(([q, r, level]) => (
        <div key={q} className="space-y-1.5 border-b px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span>¶4</span><Badge variant="secondary">{level}</Badge><Badge variant="outline">Claude</Badge></div>
          <p lang="ko"><span className="line-through decoration-destructive/60">{q}</span> → <span className="text-mark-term-ink">{r}</span></p>
          <div className="flex flex-wrap gap-1"><Button size="xs"><IconCheck data-icon="inline-start" />Accept</Button><Button size="xs" variant="ghost"><IconX data-icon="inline-start" />Dismiss</Button></div>
        </div>
      ))}
    </div>
  )
}

/** The conversation: the translator's messages (with what they pointed at), what Claude read, its answer, a write it
 *  asks to make, and the box to write in. */
function Chat({ attached, onDetach, decision, onDecide }: { attached: string | null; onDetach: () => void; decision: "allow" | "deny" | null; onDecide: (d: "allow" | "deny") => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="truncate font-medium">¶4 reserve 말장난</span>
        <span className="ml-auto shrink-0 text-muted-foreground">Opus 5.5</span>
        <Button size="icon-xs" variant="ghost" aria-label="New conversation"><IconPlus /></Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-[13px] leading-relaxed">
        <div className="ml-4 space-y-1 rounded-lg bg-muted px-2.5 py-1.5">
          <Quote text={QUOTE} />
          <p lang="ko">앞 문장의 reserved와 말장난이야? 어떻게 옮기면 좋을까?</p>
        </div>
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><IconBook className="size-3.5" />Read ¶4 and 3 around</p>
        <div className="space-y-2" lang="ko">
          <p>네, 말장난입니다. 앞의 <i>reserved</i>(말을 아끼는)와 여기 <i>reserve</i>(판단을 미루다)가 같은 뿌리로 이어집니다.</p>
          <p>"유보하는"은 뜻은 맞지만 앞 문장의 "말을 아끼는"과 이어지지 않습니다. "섣불리 판단하지 않는"이면 두 문장의 결이 맞습니다.</p>
        </div>
        <div className="ml-4 rounded-lg bg-muted px-2.5 py-1.5" lang="ko">그걸로 ¶4 번역을 고쳐 넣어줘</div>
        <div className={cn("space-y-2 rounded-md border p-2.5", decision === null && "border-ring")}>
          <p className="text-xs font-medium">Write the translation of ¶4</p>
          <DiffView before={KO} after={KO_AFTER} className="text-[13px]" />
          {decision === null ? (
            <div className="flex flex-wrap gap-1">
              <Button size="xs" onClick={() => onDecide("allow")}><IconCheck data-icon="inline-start" />Allow</Button>
              <Button size="xs" variant="ghost" onClick={() => onDecide("allow")}>Always allow</Button>
              <Button size="xs" variant="ghost" onClick={() => onDecide("deny")}><IconX data-icon="inline-start" />Deny</Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{decision === "allow" ? "Allowed · ¶4 is now draft · ⌘Z undoes" : "Denied"}</p>
          )}
        </div>
        {decision && <p className="text-xs text-muted-foreground">7s · $0.03</p>}
      </div>
      <div className="shrink-0 space-y-1.5 border-t p-2">
        {attached && <Quote text={attached} onRemove={onDetach} />}
        <div className="relative">
          <Textarea rows={2} placeholder="Ask Claude about this chapter…" className="resize-none pr-9 text-[13px]" autoFocus={Boolean(attached)} />
          <Button size="icon-xs" className="absolute right-1.5 bottom-1.5" aria-label="Send"><IconArrowUp /></Button>
        </div>
      </div>
    </div>
  )
}

/** What the translator pointed at: the paragraph and the words. */
function Quote({ text, onRemove }: { text: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs">
      <span className="shrink-0 text-muted-foreground">¶4</span>
      <span className="truncate" lang="en">“{text}”</span>
      {onRemove && <button aria-label="Remove" onClick={onRemove} className="text-muted-foreground hover:text-foreground"><IconX className="size-3" /></button>}
    </span>
  )
}
