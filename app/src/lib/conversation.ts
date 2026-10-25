/** One conversation with Claude as the page holds it (docs/agent.md §17): what the server's fold makes of it (the same
 *  fold.mjs), and the writes waiting for the translator. Built from the conversation's events on the live connection:
 *  a snapshot, then every message on top of it. Pure. */
import { applyMessage, emptyConversation, type Conversation, type SdkMessage } from "../../../server/agent/fold.mjs"
import type { LiveEvent } from "./live.ts"

export type { Conversation, Item } from "../../../server/agent/fold.mjs"

/** A write Claude asks to make, with what it would do. */
export interface Ask {
  requestId: string
  tool: string
  input: Record<string, unknown>
  preview: { summary: string; segmentId: number | null; before: string | null; after: string | null }
}

export interface ConversationView {
  /** The server's snapshot has arrived: until then there is nothing to show. */
  loaded: boolean
  state: Conversation
  asks: Ask[]
  /** The last thing the server reported going wrong with it. */
  error: string | null
  /** The model and effort its next message goes to, as the server says (null until it does). */
  config: { model: string; effort: string } | null
  /** The title Claude Code gave it, as the server says (null until it does). */
  title: string | null
  /** When the turn going on began, as the server says (epoch ms; null when none): the live line's time counts from it. */
  startedAt: number | null
  /** Sent while a turn went and not yet delivered (docs/agent.md §33): delivered, each becomes a user item. */
  queue: { uuid: string; text: string }[]
}

export const emptyView = (): ConversationView => ({ loaded: false, state: emptyConversation(), asks: [], error: null, config: null, title: null, startedAt: null, queue: [] })
const configOf = (e: LiveEvent) => (typeof e.model === "string" && typeof e.effort === "string" ? { model: e.model, effort: e.effort } : null)
const titleOf = (e: LiveEvent) => (typeof e.title === "string" ? e.title : null)
const startedAtOf = (e: LiveEvent) => (typeof e.startedAt === "number" ? e.startedAt : null)
const queueOf = (e: LiveEvent) => (Array.isArray(e.queue) ? (e.queue as { uuid: string; text: string }[]) : [])

/** The conversation after one of its events. */
export function applyEvent(view: ConversationView, e: LiveEvent): ConversationView {
  switch (e.type) {
    case "snapshot":
      return { loaded: true, state: e.state as Conversation, asks: (e.asks as Ask[]) ?? [], error: null, config: configOf(e), title: titleOf(e), startedAt: startedAtOf(e), queue: queueOf(e) }
    case "message": {
      const message = e.message as SdkMessage
      // the echo of a queued message is its delivery
      const queue = message.type === "user" && message.isReplay ? view.queue.filter((q) => q.uuid !== message.uuid) : view.queue
      return { ...view, state: applyMessage(view.state, message), queue, ...(message.type === "result" && { startedAt: null }) }
    }
    case "queued":
      return { ...view, queue: [...view.queue.filter((q) => q.uuid !== e.uuid), { uuid: String(e.uuid), text: String(e.text) }] }
    case "dropped": {
      const gone = new Set((e.uuids as string[]) ?? [])
      return { ...view, queue: view.queue.filter((q) => !gone.has(q.uuid)) }
    }
    case "ask":
      return { ...view, asks: [...view.asks.filter((a) => a.requestId !== (e.ask as Ask).requestId), e.ask as Ask] }
    case "asked":
      return { ...view, asks: view.asks.filter((a) => a.requestId !== e.requestId) }
    case "error":
      return { ...view, error: String(e.message) }
    case "configured":
      return { ...view, config: configOf(e) }
    case "titled":
      return { ...view, title: titleOf(e) }
    case "started":
      return { ...view, startedAt: startedAtOf(e) }
    default:
      return view
  }
}

/** What the translator pointed at, put before their words so Claude knows which paragraph and which words. */
export interface Pointed { segmentId: number; side: "source" | "target"; quote: string }
const POINTED = /^¶(\d+) \((English|translation)\): “([^”\n]*)”\n\n/
export const withPointed = (text: string, p: Pointed | null) =>
  p ? `¶${p.segmentId} (${p.side === "source" ? "English" : "translation"}): “${p.quote}”\n\n${text}` : text
/** A message the translator sent, taken apart again for showing: what they pointed at, and their words. */
export function readPointed(text: string): { pointed: Pointed | null; text: string } {
  const m = POINTED.exec(text)
  return m ? { pointed: { segmentId: Number(m[1]), side: m[2] === "English" ? "source" : "target", quote: m[3] }, text: text.slice(m[0].length) } : { pointed: null, text }
}
