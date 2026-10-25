import { useEffect, useState } from "react"
import { IconAlertTriangle, IconArrowBackUp, IconArrowsDiagonalMinimize2, IconBook, IconCircleCheck, IconMessage, IconNote, IconPencil, IconSearch, IconWorldSearch } from "@tabler/icons-react"
import { Streamdown } from "streamdown"
import { cjk } from "@streamdown/cjk"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Item as ItemCard, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { PixelLoader } from "@/components/ui/pixel-loader"
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle,
} from "@/components/ui/trace"
import type { AskDecision, TurnChecks } from "@/data/api"
import type { Claude } from "@/data/useClaude"
import { DiffView } from "@/features/review/DiffView"
import { readPointed, type Ask, type Item } from "@/lib/conversation"
import { WRITE_TOOLS, checksLine, compactLine, elapsedText, liveLine, toolLine, turnLine } from "@/lib/trace"
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
  const turning = view.state.status !== "idle"
  const working = turning || pending !== null
  // sent while the turn goes (§33): the server's queue, and the one the server has not yet taken
  const queued = [...view.queue.map((q) => q.text), ...(pending !== null && turning ? [pending] : [])]
  /** A turn's checks are kept by the translator's message that began it. */
  const checksAt = (i: number) => { const began = blocks[i - 1]; return began?.kind === "user" ? claude.checksOf(began.item.uuid) : null }
  // The turn going on has its message from Enter, its one live line at the end (docs/agent.md §26): before the echo
  // under the words sent, then under the echo, then the block its first finished part opens. Keyed by the message
  // that began the turn, so it is not drawn anew when a part finishes or the turn ends.
  const last = blocks.at(-1)
  const open = working && (pending === null || turning) && last?.kind === "claude" && !last.turn ? last : null
  const line = working ? liveLine({ sent: pending !== null && !turning, live: view.state.live, began: Boolean(open?.parts.length), waiting: view.asks.length > 0, retry: view.state.retry, compacting: view.state.compacting }) : null
  const since = view.startedAt ?? claude.sentAt
  const current = { line, since, waiting: view.asks.length > 0 }
  const limits = view.state.limits
  const items: React.ReactNode[] = []
  let began = "start"
  let n = 0
  blocks.forEach((b, i) => {
    if (b.kind === "user") {
      began = b.item.uuid
      n = 0
      items.push(
        <MessageScrollerItem key={b.item.uuid} messageId={b.item.uuid} scrollAnchor>
          <UserMessage text={b.item.text} />
        </MessageScrollerItem>,
      )
      return
    }
    items.push(
      <MessageScrollerItem key={`${began}:${n++}`}>
        <ClaudeMessage parts={b.parts} turn={b.turn} limits={limits} live={b === open ? view.state.live : null} current={b === open ? current : null}
          stands={claude.stands} onUndo={claude.undoFrom}
          checks={checksAt(i)}
          undoable={working ? [] : blocks.slice(i).flatMap(writesOf).filter((id) => claude.stands(id) === true)} />
      </MessageScrollerItem>,
    )
  })
  const empty = (key: string, live: Claude["view"]["state"]["live"]) => (
    <MessageScrollerItem key={key}>
      <ClaudeMessage parts={[]} turn={null} limits={limits} live={live} current={current} stands={claude.stands} onUndo={claude.undoFrom} checks={null} undoable={[]} />
    </MessageScrollerItem>
  )
  if (pending !== null && !turning) {
    items.push(
      <MessageScrollerItem key="pending" scrollAnchor>
        <UserMessage text={pending} />
      </MessageScrollerItem>,
      empty("pending:0", null),
    )
  } else if (working && last?.kind === "user") items.push(empty(`${last.item.uuid}:0`, view.state.live))
  // at work with no open block to put the line in (a compaction, §32: no message of the translator's began it)
  else if (working && !open) items.push(empty(`${began}:${n}`, view.state.live))
  queued.forEach((text, i) => items.push(
    <MessageScrollerItem key={`queued:${i}`} scrollAnchor={i === queued.length - 1}>
      <UserMessage text={text} queued />
    </MessageScrollerItem>,
  ))
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label="Conversation with Claude">
          <MessageScrollerContent className="gap-5 p-3" aria-busy={working}>
            {!blocks.length && !pending && (
              <p className="px-1 py-6 text-center text-xs/relaxed text-muted-foreground">
                Ask about this chapter, or select words in the text and choose Ask Claude (⌘L).
              </p>
            )}
            {items}
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

/** The translator's message; queued, it waits for Claude to reach it (§33): dimmed, and said so. */
function UserMessage({ text, queued = false }: { text: string; queued?: boolean }) {
  const { pointed, text: words } = readPointed(text)
  return (
    <Message align="end" data-queued={queued || undefined}>
      <MessageContent className={queued ? "items-end opacity-60" : undefined}>
        <Bubble align="end" variant="muted">
          <BubbleContent className="space-y-1 text-sm/relaxed whitespace-pre-wrap">
            {pointed && <Pointed pointed={pointed} />}
            <p lang="ko">{words}</p>
          </BubbleContent>
        </Bubble>
        {queued && <span className="text-xs text-muted-foreground">Queued</span>}
      </MessageContent>
    </Message>
  )
}

/** Claude's side of a turn: runs of reading and thinking as one Trace each, its words between them, the turn's end —
 *  and there, Undo from here: Claude's changes from this turn to the end of the conversation, taken back together
 *  (Claude Code's rewind), or not at all, saying why (docs/agent.md §18). */
function ClaudeMessage({ parts, turn, limits, live, current, stands, undoable, onUndo, checks }: {
  parts: Item[]; turn: Extract<Item, { kind: "turn" }> | null; limits: Claude["view"]["state"]["limits"]; live: Claude["view"]["state"]["live"]
  /** The turn going on's: its live line's words (null while Claude's words stream), its start, whether a write waits. */
  current: { line: string | null; since: number | null; waiting: boolean } | null
  stands: Claude["stands"]; undoable: string[]; onUndo: Claude["undoFrom"]; checks: TurnChecks | null
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
  const end = turn ? turnLine(turn, limits) : null
  return (
    <Message>
      <MessageContent className="gap-3">
        {runs.map((r, i) =>
          Array.isArray(r) ? <Steps key={i} steps={r} stands={stands} /> : <Words key={r.id} text={r.text} />,
        )}
        {live?.kind === "text" && <Words text={live.text} streaming />}
        {current?.line && <LiveLine line={current.line} since={current.since} waiting={current.waiting} thought={live?.kind === "thinking" ? live.text : ""} />}
        {turn && checks && <ChecksLine checks={checks} />}
        {/* inside the content: Message lays its children in a row, and the turn's end goes under the answer */}
        {end && (
          <MessageFooter data-turn-end className={end.stopped ? "gap-1 px-0 text-xs font-normal text-destructive" : "gap-1 px-0 text-xs font-normal"}>
            {end.text}
            {undoable.length > 0 && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => void undo()}>
                <IconArrowBackUp data-icon="inline-start" />Undo from here ({undoable.length})
              </Button>
            )}
          </MessageFooter>
        )}
        {refusal && (
          <p data-refusal className="text-xs/relaxed text-destructive">
            Not undone: {refusal}. {refusal.startsWith("You") ? "Undo yours first (⌘Z), or keep it." : "Take that back first, or keep it."}
          </p>
        )}
      </MessageContent>
    </Message>
  )
}

/** The turn's one live line (docs/agent.md §26): what Claude is doing, and the time since the turn began; under it,
 *  Claude's thought as it streams, its last four lines. A write waiting for the translator outranks the rest: Claude is
 *  not working then, it is waiting — no loader, no time. Only the words are read aloud. */
function LiveLine({ line, since, waiting, thought }: { line: string; since: number | null; waiting: boolean; thought: string }) {
  return (
    <Trace data-live-line>
      <TraceLine status={waiting ? undefined : "running"}>
        {!waiting && <TraceIcon><PixelLoader /></TraceIcon>}
        <TraceTitle role="status">{line}</TraceTitle>
        {!waiting && since !== null && <Elapsed since={since} />}
      </TraceLine>
      {thought && (
        // the newest words stay in sight, the oldest go out at the top
        <div data-thought-stream className="flex max-h-[4lh] flex-col justify-end overflow-hidden border-l pl-2 text-xs/relaxed text-muted-foreground">
          <p className="whitespace-pre-wrap">{thought}</p>
        </div>
      )}
    </Trace>
  )
}

/** The time since `since`, a tenth of a second at a time. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(tick)
  }, [])
  return <TraceDescription aria-hidden>{elapsedText(now - since)}</TraceDescription>
}

// Claude's answer read by Octave's rules, none of which costs the panel width (docs/agent.md §27): 16px between
// blocks, headings a little larger with room above, list markers outside so a wrapped item keeps to its text, a quote
// not slanted (Korean has no italic), lines that end well
const WORDS = [
  "space-y-4 [&>:first-child]:mt-0 [&_p]:text-pretty",
  "[&_:is(h1,h2,h3,h4)]:mt-[1.6em] [&_:is(h1,h2,h3,h4)]:mb-2 [&_:is(h1,h2,h3,h4)]:leading-snug",
  "[&_:is(h1,h2)]:text-[1.25em] [&_:is(h1,h2)]:font-bold [&_h3]:text-[1.125em] [&_h3]:font-semibold [&_h4]:text-[1em] [&_h4]:font-semibold",
  "[&_:is(ul,ol)]:list-outside [&_:is(ul,ol)]:pl-5 [&_li]:my-1 [&_li]:py-0 [&_li::marker]:text-muted-foreground",
  "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:not-italic",
].join(" ")

function Words({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    // 15px in a softer black; a Korean word moves whole to the next line, only a word too long for the line breaks
    <div lang="ko" className="text-[15px]/[1.625] text-answer antialiased break-keep [overflow-wrap:anywhere]">
      <Streamdown className={WORDS} plugins={PLUGINS} mode={streaming ? "streaming" : "static"}>{text}</Streamdown>
    </div>
  )
}

/** What the checks found in the translations Claude wrote in the turn: a line, and what is left wrong under it. */
function ChecksLine({ checks }: { checks: TurnChecks }) {
  const { ok, text, details } = checksLine(checks)
  const icon = <TraceIcon>{ok ? <IconCircleCheck /> : <IconAlertTriangle />}</TraceIcon>
  return (
    <Trace data-checks={ok === true ? "passed" : ok === false ? "failed" : "unchecked"}>
      <TraceLine status={ok === false ? "error" : undefined}>
        {icon}
        <TraceTitle>{text}</TraceTitle>
      </TraceLine>
      {details.length > 0 && (
        <ul className="ml-5 space-y-0.5 text-xs/relaxed text-muted-foreground" lang="ko">
          {details.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
    </Trace>
  )
}

/** What Claude read and thought, one line each; a thought opens to its summary. A change taken back stays, struck. */
function Steps({ steps, stands }: { steps: Item[]; stands: Claude["stands"] }) {
  return (
    <Trace>
      {steps.map((s, i) => {
        if (s.kind === "thinking") return <Thought key={s.id} text={s.text} />
        if (s.kind === "compact") return (
          <TraceLine key={`compact-${i}`} data-compacted>
            <TraceIcon><IconArrowsDiagonalMinimize2 /></TraceIcon>
            <TraceTitle>{compactLine(s)}</TraceTitle>
          </TraceLine>
        )
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
        <ItemTitle className="line-clamp-none text-sm/relaxed">{summary}?</ItemTitle>
        {before && after ? <DiffView before={before} after={after} lang="ko" className="text-sm/relaxed" /> : after && <p lang="ko" className="text-sm/relaxed whitespace-pre-wrap">{after}</p>}
      </ItemContent>
      <ItemActions className="w-full justify-end">
        <Button size="sm" variant="ghost" onClick={() => onAnswer("deny")}>Deny</Button>
        <Button size="sm" variant="outline" onClick={() => onAnswer("always")} title="Allow this kind of change for the rest of this conversation">Always</Button>
        <Button size="sm" onClick={() => onAnswer("allow")}>Allow</Button>
      </ItemActions>
    </ItemCard>
  )
}
