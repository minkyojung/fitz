import { useState } from "react"
import {
  IconArrowUp, IconBook, IconCheck, IconChevronDown, IconMessage, IconNote, IconPencil, IconPlayerStopFilled, IconPlus, IconSparkles, IconX,
} from "@tabler/icons-react"

import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle,
} from "@/components/ui/trace"
import { DiffView } from "@/features/review/DiffView"
import { cn } from "cn"

// Design check for docs/agent.md step 9 before it is built: talking with Claude inside the editor, made of shadcn's
// AI Elements parts (Message, Bubble, Trace, Item, Input Group, Message Scroller). No new column: Claude is called
// from the text (Ask Claude, ⌘L), talks in the panel's Claude tab — this chapter's suggestions fold into its head —
// and what it changes lands back in the text. Sample text: The Great Gatsby (public domain).

const EN = "He didn't say any more, but we've always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that. In consequence, I'm inclined to reserve all judgments, a habit that has opened up many curious natures to me."
const KO = "아버지는 더 말씀하지 않으셨지만, 우리 부자는 늘 말을 아끼면서도 유난히 잘 통하는 사이였다. 그래서 나는 모든 판단을 유보하는 버릇이 생겼는데, 그 버릇 덕분에 별난 사람들이 내게 마음을 열었다."
const KO_AFTER = KO.replace("모든 판단을 유보하는", "섣불리 판단하지 않는")
const QUOTE = "reserve all judgments"
const PREV = { en: "In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since.", ko: "지금보다 어리고 쉽게 상처받던 시절, 아버지가 내게 해 주신 충고가 있는데 나는 그 뒤로 줄곧 그 말을 곱씹어 왔다." }
const MODELS = [["claude-opus-5-5", "Opus 5.5"], ["claude-sonnet-5-5", "Sonnet 5.5"], ["claude-haiku-5-5", "Haiku 5.5"]] as const
const EFFORTS = ["low", "medium", "high"] as const

type Decision = "allow" | "always" | "deny" | null

export function AgentGallery() {
  const [width, setWidth] = useState(320)
  const [running, setRunning] = useState(false)
  const [attached, setAttached] = useState<string | null>(null)
  const [toolbar, setToolbar] = useState(true)
  const [decision, setDecision] = useState<Decision>(null)
  const ask = () => { setAttached(QUOTE); setToolbar(false) }
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xs font-medium text-muted-foreground">
        Claude 대화 갤러리 (B안 + shadcn AI Elements) · 본문에서 부르고(구절 선택 → Ask Claude, ⌘L), Claude 탭에서 대화하고, 바뀐 것은 본문으로
      </h1>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">패널 폭</span>
        {[230, 320].map((w) => (
          <Button key={w} size="xs" variant={width === w ? "default" : "outline"} onClick={() => setWidth(w)}>{w}px{w === 230 ? " (지금 기본)" : " (Claude 탭일 때)"}</Button>
        ))}
        <span className="ml-4 text-muted-foreground">상태</span>
        <Button size="xs" variant={running ? "outline" : "default"} onClick={() => setRunning(false)}>끝난 턴</Button>
        <Button size="xs" variant={running ? "default" : "outline"} onClick={() => setRunning(true)}>Claude가 답하는 중</Button>
        <Button size="xs" variant="ghost" onClick={() => { setDecision(null); setToolbar(true); setAttached(null) }}>처음부터</Button>
      </div>

      <div className="flex h-[640px] overflow-hidden rounded-md border text-sm" style={{ width: 1160 }}>
        <main className="min-w-0 flex-1 space-y-6 overflow-auto p-6">
          <div className="grid grid-cols-2 gap-6">
            <p className="reading text-[15px] text-muted-foreground" lang="en">{PREV.en}</p>
            <p className="reading text-[15px]" lang="ko">{PREV.ko}</p>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <p className="reading text-[15px] text-muted-foreground" lang="en">
              {EN.slice(0, EN.indexOf(QUOTE))}
              <span className="relative">
                {toolbar && <SelectionToolbar onAsk={ask} onClose={() => setToolbar(false)} />}
                <span className={cn(toolbar && "bg-blue-200/60 dark:bg-blue-500/30")}>{QUOTE}</span>
              </span>
              {EN.slice(EN.indexOf(QUOTE) + QUOTE.length)}
            </p>
            <p className="reading text-[15px]" lang="ko">{decision === "allow" || decision === "always" ? KO_AFTER : KO}</p>
          </div>
        </main>
        <aside className="flex shrink-0 flex-col border-l" style={{ width }}>
          <PanelTabs />
          <ClaudeTab running={running} attached={attached} onDetach={() => setAttached(null)} decision={decision} onDecide={setDecision} />
        </aside>
      </div>
    </div>
  )
}

/** The editor's panel tabs, Suggestions folded into Claude. */
function PanelTabs() {
  return (
    <div className="m-2 flex flex-wrap gap-0.5 self-start rounded-lg bg-muted p-[3px]">
      {["History", "Find", "Glossary", "Notes", "Claude"].map((t) => (
        <span key={t} className={cn("flex h-[26px] flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap text-foreground/60", t === "Claude" && "bg-background text-foreground")}>
          {t === "Claude" && <IconSparkles className="size-3.5" />}{t}
          {t === "Notes" && <Badge variant="secondary">5</Badge>}
        </span>
      ))}
    </div>
  )
}

/** The selection toolbar the editor already has (Comment, Translator's note), with Ask Claude added. */
function SelectionToolbar({ onAsk, onClose }: { onAsk: () => void; onClose: () => void }) {
  return (
    <span className="absolute bottom-full left-0 z-10 mb-1 flex items-center gap-0.5 rounded-md border bg-popover p-0.5 font-sans shadow-md">
      <Button size="xs" variant="ghost"><IconMessage data-icon="inline-start" />Comment</Button>
      <Button size="xs" variant="ghost"><IconNote data-icon="inline-start" />Translator's note</Button>
      <Button size="xs" variant="ghost" onClick={onAsk}><IconSparkles data-icon="inline-start" />Ask Claude <kbd className="ml-1 text-[10px] text-muted-foreground">⌘L</kbd></Button>
      <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={onClose}><IconX /></Button>
    </span>
  )
}

/** One head row (the conversation, this chapter's suggestions), the thread, the box to write in. */
function ClaudeTab({ running, attached, onDetach, decision, onDecide }: {
  running: boolean; attached: string | null; onDetach: () => void; decision: Decision; onDecide: (d: Decision) => void
}) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t">
      <Collapsible open={suggestionsOpen} onOpenChange={setSuggestionsOpen} className="shrink-0 border-b">
        <div className="flex h-9 items-center gap-1 px-1.5">
          <ConversationMenu />
          <Button size="xs" variant={suggestionsOpen ? "secondary" : "ghost"} className="ml-auto shrink-0" onClick={() => setSuggestionsOpen(!suggestionsOpen)}>
            Suggestions <Badge variant="secondary">2</Badge>
          </Button>
        </div>
        <CollapsibleContent className="max-h-64 overflow-auto border-t">
          <SuggestionList />
        </CollapsibleContent>
      </Collapsible>
      <Thread running={running} decision={decision} onDecide={onDecide} />
      <Composer running={running} attached={attached} onDetach={onDetach} />
    </div>
  )
}

/** The conversation's title is the menu of conversations: the recent ones, and a new one. */
function ConversationMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="xs" variant="ghost" className="min-w-0 justify-start" />}>
        <span className="truncate">¶4 reserve 말장난</span>
        <IconChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem><IconPlus />New conversation</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Recent</DropdownMenuLabel>
          <DropdownMenuItem>¶4 reserve 말장난<span className="ml-auto text-muted-foreground">now</span></DropdownMenuItem>
          <DropdownMenuItem>Zemurray 표기<span className="ml-auto text-muted-foreground">2h</span></DropdownMenuItem>
          <DropdownMenuItem>18장 리뷰<span className="ml-auto text-muted-foreground">1d</span></DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** This chapter's suggestions as built in step 7, shortened. */
function SuggestionList() {
  return (
    <div className="text-sm">
      <div className="border-b px-3 py-2"><Button size="xs" variant="outline"><IconSparkles data-icon="inline-start" />Review this chapter with Claude</Button></div>
      {[["모든 판단을 유보하는", "섣불리 판단하지 않는", "medium"], ["말을 아끼면서도", "말수는 적어도", "low"]].map(([q, r, level]) => (
        <div key={q} className="space-y-1.5 border-b px-3 py-2 last:border-b-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span>¶4</span><Badge variant="secondary">{level}</Badge></div>
          <p lang="ko"><span className="line-through decoration-destructive/60">{q}</span> → <span className="text-mark-term-ink">{r}</span></p>
          <div className="flex flex-wrap gap-1"><Button size="xs"><IconCheck data-icon="inline-start" />Accept</Button><Button size="xs" variant="ghost"><IconX data-icon="inline-start" />Dismiss</Button></div>
        </div>
      ))}
    </div>
  )
}

/** The conversation, as AI Elements' Chat lays it out: the translator's turns in a muted bubble on the right; Claude's
 *  without a bubble — what it read and thought as a Trace above its answer, a write it asks for as an Item. */
function Thread({ running, decision, onDecide }: { running: boolean; decision: Decision; onDecide: (d: Decision) => void }) {
  const [thoughtOpen, setThoughtOpen] = useState(false)
  return (
    <MessageScrollerProvider>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-5 p-3">
            <MessageScrollerItem scrollAnchor>
              <Message align="end">
                <MessageContent>
                  <Bubble align="end" variant="muted">
                    <BubbleContent className="space-y-1 text-[13px]">
                      <Quote text={QUOTE} />
                      <p lang="ko">앞 문장의 reserved와 말장난이야? 어떻게 옮기면 좋을까?</p>
                    </BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            </MessageScrollerItem>
            <MessageScrollerItem>
              <Message>
                <MessageContent className="gap-3">
                  <Trace>
                    <TraceLine>
                      <TraceIcon><IconBook /></TraceIcon>
                      <TraceTitle>Read ¶4 and 3 around</TraceTitle>
                    </TraceLine>
                    <TraceCollapsible open={thoughtOpen} onOpenChange={setThoughtOpen}>
                      <TraceCollapsibleTrigger>
                        <TraceLine>
                          <TraceTitle>Thought</TraceTitle>
                          <TraceDescription>4s</TraceDescription>
                        </TraceLine>
                      </TraceCollapsibleTrigger>
                      <TraceCollapsibleContent className="whitespace-pre-wrap" lang="ko">
                        reserved(말을 아끼는)와 reserve all judgments가 같은 낱말로 이어진다. 번역은 앞을 "말을 아끼면서도", 뒤를 "유보하는"으로 옮겨 연결이 끊겼다.
                      </TraceCollapsibleContent>
                    </TraceCollapsible>
                  </Trace>
                  <div className="space-y-2 text-[13px] leading-relaxed" lang="ko">
                    <p>네, 말장난입니다. 앞의 <i>reserved</i>(말을 아끼는)와 여기 <i>reserve</i>(판단을 미루다)가 같은 낱말로 이어집니다.</p>
                    <p>"유보하는"은 뜻은 맞지만 앞의 "말을 아끼는"과 이어지지 않습니다. "섣불리 판단하지 않는"이면 결이 맞습니다.</p>
                  </div>
                </MessageContent>
              </Message>
            </MessageScrollerItem>
            <MessageScrollerItem scrollAnchor>
              <Message align="end">
                <MessageContent>
                  <Bubble align="end" variant="muted"><BubbleContent className="text-[13px]" lang="ko">그걸로 ¶4 번역을 고쳐 넣어줘</BubbleContent></Bubble>
                </MessageContent>
              </Message>
            </MessageScrollerItem>
            <MessageScrollerItem>
              <Message>
                <MessageContent className="gap-3">
                  {decision === null ? (
                    // a write waits for the translator: AI Elements' Confirmation (Item + Button), with the change shown
                    <Item variant="outline" size="sm">
                      <ItemMedia variant="icon"><IconPencil /></ItemMedia>
                      <ItemContent>
                        <ItemTitle>Write the translation of ¶4?</ItemTitle>
                        <DiffView before={KO} after={KO_AFTER} className="text-[13px]" />
                      </ItemContent>
                      <ItemActions className="w-full justify-end">
                        <Button size="sm" variant="ghost" onClick={() => onDecide("deny")}>Deny</Button>
                        <Button size="sm" variant="outline" onClick={() => onDecide("always")}>Always</Button>
                        <Button size="sm" onClick={() => onDecide("allow")}>Allow</Button>
                      </ItemActions>
                    </Item>
                  ) : (
                    // once answered, the card becomes a line of the trace
                    <Trace>
                      <TraceLine status={decision === "deny" ? "error" : undefined}>
                        <TraceIcon><IconPencil /></TraceIcon>
                        <TraceTitle>{decision === "deny" ? "Denied: write the translation of ¶4" : "Wrote the translation of ¶4"}</TraceTitle>
                        {decision !== "deny" && <TraceDescription>⌘Z undoes</TraceDescription>}
                      </TraceLine>
                    </Trace>
                  )}
                  {running && (
                    <Trace>
                      <TraceLine status="running">
                        <TraceTitle>Thinking</TraceTitle>
                      </TraceLine>
                    </Trace>
                  )}
                </MessageContent>
                {decision !== null && !running && <MessageFooter className="px-0">7s · $0.03</MessageFooter>}
              </Message>
            </MessageScrollerItem>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

/** AI Elements' Prompt Input: the box, what the translator pointed at above it, the model and effort menu and send
 *  (Stop while Claude answers) below. */
function Composer({ running, attached, onDetach }: { running: boolean; attached: string | null; onDetach: () => void }) {
  const [model, setModel] = useState<string>("claude-opus-5-5")
  const [effort, setEffort] = useState<string>("medium")
  return (
    <div className="shrink-0 p-2">
      <InputGroup>
        {attached && (
          <InputGroupAddon align="block-start">
            <Quote text={attached} onRemove={onDetach} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea aria-label="Message" placeholder="Ask Claude about this chapter…" className="min-h-14 text-[13px]" />
        <InputGroupAddon align="block-end" className="pt-1">
          <DropdownMenu>
            <DropdownMenuTrigger render={<InputGroupButton size="sm" variant="ghost" className="text-muted-foreground" />}>
              {MODELS.find(([id]) => id === model)?.[1]} · {effort}<IconChevronDown data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={model} onValueChange={(v) => setModel(String(v))}>
                  {MODELS.map(([id, name]) => <DropdownMenuRadioItem key={id} value={id}>{name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Effort</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={effort} onValueChange={(v) => setEffort(String(v))}>
                  {EFFORTS.map((e) => <DropdownMenuRadioItem key={e} value={e}>{e}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {running ? (
            <InputGroupButton size="icon-sm" variant="default" className="ml-auto" aria-label="Stop"><IconPlayerStopFilled /></InputGroupButton>
          ) : (
            <InputGroupButton size="icon-sm" variant="default" className="ml-auto" aria-label="Send"><IconArrowUp /></InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

/** What the translator pointed at: the paragraph and the words. */
function Quote({ text, onRemove }: { text: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs text-foreground">
      <span className="shrink-0 text-muted-foreground">¶4</span>
      <span className="truncate" lang="en">“{text}”</span>
      {onRemove && <button aria-label="Remove" onClick={onRemove} className="text-muted-foreground hover:text-foreground"><IconX className="size-3" /></button>}
    </span>
  )
}
