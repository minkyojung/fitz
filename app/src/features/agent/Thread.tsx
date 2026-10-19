import { useState } from "react"
import { IconArrowBackUp, IconBook, IconMessage, IconNote, IconPencil, IconSearch, IconWorldSearch } from "@tabler/icons-react"
import { Streamdown } from "streamdown"
import { cjk } from "@streamdown/cjk"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Item as ItemCard, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle,
} from "@/components/ui/trace"
import type { AskDecision } from "@/data/api"
import type { Claude } from "@/data/useClaude"
import { DiffView } from "@/features/review/DiffView"
import { readPointed, type Ask, type Item } from "@/lib/conversation"
import { WRITE_TOOLS, doingLine, toolLine, turnLine } from "@/lib/trace"
import { Pointed } from "./Pointed"

// Korean emphasis next to quotes ("**"말"**과") needs the CJK rules; Claude's words are sanitized by Streamdown
const PLUGINS = { cjk }

type Block = { kind: "user"; item: Extract<Item, { kind: "user" }> } | { kind: "claude"; parts: Item[]; turn: Extract<Item, { kind: "turn" }> | null }

/** The translator's messages, and between them what Claude did and said, closed by the turn's end. */
function blocksOf(items: Item[]): Block[] {
  const blocks: Block[] = []
  for (const it of items) {
    if (it.kind === "user") { blocks.push({ kind: "user", item: it }); continue }
    let last = blocks.at(-1)
    if (last?.kind !== "claude" || last.turn) { last = { kind: "claude", parts: [], turn: null }; blocks.push(last) }
    if (it.kind === "turn") last.turn = it
    else last.parts.push(it)
  }
  return blocks
}

/** The tool calls of a turn that changed the book. */
const writesOf = (b: Block) =>
  b.kind === "claude" ? b.parts.flatMap((p) => (p.kind === "tool" && WRITE_TOOLS.has(p.name) && p.status === "done" ? [p.id] : [])) : []

const ICON: Record<string, React.ReactNode> = {
  read: <IconBook />, book: <IconBook />, glossary: <IconBook />, search: <IconSearch />, WebSearch: <IconWorldSearch />,
  set_translation: <IconPencil />, set_glossary_term: <IconPencil />, add_comment: <IconMessage />, add_translator_note: <IconNote />,
}

/** The conversation, laid out as shadcn AI Elements' Chat: the translator's turns in a muted bubble on the right;
 *  Claude's without one — what it read and thought as a Trace, then its words; a write it asks for as a
 *  Confirmation item. */
export function Thread({ claude }: { claude: Claude }) {
  const { view, pending } = claude
  const blocks = blocksOf(view.state.items)
  const working = view.state.status !== "idle" || pending !== null
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label="Conversation with Claude">
          <MessageScrollerContent className="gap-5 p-3" aria-busy={working}>
            {!blocks.length && !pending && (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                Ask about this chapter, or select words in the text and choose Ask Claude (⌘L).
              </p>
            )}
            {blocks.map((b, i) =>
              b.kind === "user" ? (
                <MessageScrollerItem key={b.item.uuid} messageId={b.item.uuid} scrollAnchor>
                  <UserMessage text={b.item.text} />
                </MessageScrollerItem>
              ) : (
                <MessageScrollerItem key={`c${i}`}>
                  <ClaudeMessage parts={b.parts} turn={b.turn} live={i === blocks.length - 1 && !pending ? view.state.live : null}
                    working={i === blocks.length - 1 && !pending && view.state.status !== "idle"} waiting={view.asks.length > 0}
                    stands={claude.stands} onUndo={claude.undoFrom}
                    undoable={working ? [] : blocks.slice(i).flatMap(writesOf).filter((id) => claude.stands(id) === true)} />
                </MessageScrollerItem>
              ),
            )}
            {pending !== null && (
              <MessageScrollerItem scrollAnchor>
                <UserMessage text={pending} />
                <Trace className="mt-3"><TraceLine status="running"><TraceTitle>Starting</TraceTitle></TraceLine></Trace>
              </MessageScrollerItem>
            )}
            {view.asks.map((a) => (
              <MessageScrollerItem key={a.requestId}>
                <Confirmation ask={a} onAnswer={(d) => claude.answer(a.requestId, d)} />
              </MessageScrollerItem>
            ))}
            {view.error && (
              <MessageScrollerItem>
                <Trace><TraceLine status="error"><TraceTitle>{view.error}</TraceTitle></TraceLine></Trace>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function UserMessage({ text }: { text: string }) {
  const { pointed, text: words } = readPointed(text)
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end" variant="muted">
          <BubbleContent className="space-y-1 text-[13px] whitespace-pre-wrap">
            {pointed && <Pointed pointed={pointed} />}
            <p lang="ko">{words}</p>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

/** Claude's side of a turn: runs of reading and thinking as one Trace each, its words between them, the turn's end —
 *  and there, Undo from here: Claude's changes from this turn to the end of the conversation, taken back together
 *  (Claude Code's rewind), or not at all, saying why (docs/agent.md §18). */
function ClaudeMessage({ parts, turn, live, working, waiting, stands, undoable, onUndo }: {
  parts: Item[]; turn: Extract<Item, { kind: "turn" }> | null; live: Claude["view"]["state"]["live"]; working: boolean; waiting: boolean
  stands: Claude["stands"]; undoable: string[]; onUndo: Claude["undoFrom"]
}) {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const undo = async () => {
    setBusy(true)
    try { setRefusal(await onUndo(undoable)) } catch (e) { setRefusal((e as Error).message) } finally { setBusy(false) }
  }
  const runs: (Item[] | Extract<Item, { kind: "text" }>)[] = []
  for (const p of parts) {
    if (p.kind === "text") runs.push(p)
    else if (Array.isArray(runs.at(-1))) (runs.at(-1) as Item[]).push(p)
    else runs.push([p])
  }
  const end = turn ? turnLine(turn) : null
  return (
    <Message>
      <MessageContent className="gap-3">
        {runs.map((r, i) =>
          Array.isArray(r) ? <Steps key={i} steps={r} stands={stands} /> : <Words key={r.id} text={r.text} />,
        )}
        {live?.kind === "text" && <Words text={live.text} streaming />}
        {working && live?.kind !== "text" && (
          // a write waiting for the translator outranks the rest: Claude is not working then, it is waiting
          <Trace>
            {waiting ? (
              <TraceLine><TraceTitle>Waiting for your answer</TraceTitle></TraceLine>
            ) : (
              <TraceLine status="running"><TraceTitle>{live?.kind === "thinking" ? "Thinking" : live?.kind === "tool" ? doingLine(live.name) : "Working"}</TraceTitle></TraceLine>
            )}
          </Trace>
        )}
        {/* inside the content: Message lays its children in a row, and the turn's end goes under the answer */}
        {end && (
          <MessageFooter data-turn-end className={end.stopped ? "gap-1 px-0 text-destructive" : "gap-1 px-0"}>
            {end.text}
            {undoable.length > 0 && (
              <Button size="xs" variant="ghost" className="h-5 px-1.5 text-muted-foreground" disabled={busy} onClick={() => void undo()}>
                <IconArrowBackUp data-icon="inline-start" />Undo from here ({undoable.length})
              </Button>
            )}
          </MessageFooter>
        )}
        {refusal && (
          <p data-refusal className="text-xs text-destructive">
            Not undone: {refusal}. {refusal.startsWith("You") ? "Undo yours first (⌘Z), or keep it." : "Take that back first, or keep it."}
          </p>
        )}
      </MessageContent>
    </Message>
  )
}

// a chat answer's headings are its own sections, not the page's: the text's size, set apart by weight only
const WORDS = "space-y-2 [&_:is(h1,h2,h3,h4)]:mt-3 [&_:is(h1,h2,h3,h4)]:mb-1 [&_:is(h1,h2,h3,h4)]:text-[13px] [&_:is(h1,h2,h3,h4)]:font-semibold"

function Words({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div lang="ko" className="text-[13px] leading-relaxed">
      <Streamdown className={WORDS} plugins={PLUGINS} mode={streaming ? "streaming" : "static"}>{text}</Streamdown>
    </div>
  )
}

/** What Claude read and thought, one line each; a thought opens to its summary. A change taken back stays, struck. */
function Steps({ steps, stands }: { steps: Item[]; stands: Claude["stands"] }) {
  return (
    <Trace>
      {steps.map((s) => {
        if (s.kind === "thinking") return <Thought key={s.id} text={s.text} />
        if (s.kind !== "tool") return null
        const line = toolLine(s)
        if (!line) return null
        const undone = WRITE_TOOLS.has(s.name) && s.status === "done" && stands(s.id) === false
        return (
          <TraceLine key={s.id} data-undone={undone || undefined} className={undone ? "line-through opacity-60" : undefined}
            status={s.status === "running" ? "running" : s.status === "error" ? "error" : undefined}>
            <TraceIcon>{ICON[s.name] ?? <IconBook />}</TraceIcon>
            <TraceTitle>{line.title}</TraceTitle>
            {(line.note || undone) && <TraceDescription className="no-underline">{undone ? "undone" : line.note}</TraceDescription>}
          </TraceLine>
        )
      })}
    </Trace>
  )
}

function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine><TraceTitle>Thought</TraceTitle></TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** A write Claude asks to make: AI Elements' Confirmation, with what it would change. */
function Confirmation({ ask, onAnswer }: { ask: Ask; onAnswer: (d: AskDecision) => void }) {
  const { summary, before, after } = ask.preview
  return (
    <ItemCard variant="outline" size="sm" data-ask={ask.requestId}>
      <ItemMedia variant="icon">{ICON[ask.tool] ?? <IconPencil />}</ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none">{summary}?</ItemTitle>
        {before && after ? <DiffView before={before} after={after} lang="ko" className="text-[13px]" /> : after && <p lang="ko" className="text-[13px] whitespace-pre-wrap">{after}</p>}
      </ItemContent>
      <ItemActions className="w-full justify-end">
        <Button size="sm" variant="ghost" onClick={() => onAnswer("deny")}>Deny</Button>
        <Button size="sm" variant="outline" onClick={() => onAnswer("always")} title="Allow this kind of change for the rest of this conversation">Always</Button>
        <Button size="sm" onClick={() => onAnswer("allow")}>Allow</Button>
      </ItemActions>
    </ItemCard>
  )
}
