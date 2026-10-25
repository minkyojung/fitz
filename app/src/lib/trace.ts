/** What Claude did, in the words the Claude tab shows (docs/agent.md §17): one line per tool call, the block it is
 *  writing now, the end of a turn. Pure. */
import type { Item } from "./conversation.ts"

type Tool = Extract<Item, { kind: "tool" }>
type Turn = Extract<Item, { kind: "turn" }>

/** The fitz tools that change the book: what Claude did with them can be taken back from the conversation. */
export const WRITE_TOOLS = new Set(["set_translation", "set_glossary_term", "add_comment", "add_translator_note"])

const paras = (ids: number[]) => (ids.length > 4 ? `${ids.length} paragraphs` : ids.map((id) => `¶${id}`).join(", "))

/** The call's line: what it was, and for one that did not go through, why. null: not shown (a task's answer). */
export function toolLine(t: Tool): { title: string; note?: string } | null {
  const i = t.input
  const p = `¶${i.segmentId}`
  const write = (doing: string, did: string, didNot: string) =>
    t.status === "running" ? { title: doing } : t.status === "done" ? { title: did } : { title: didNot, note: why(t.result) }
  switch (t.name) {
    case "read": {
      const ids = Array.isArray(i.ids) ? (i.ids as number[]) : []
      if (typeof i.chapterId === "number") return { title: typeof i.from === "number" && i.from > 0 ? "Read on in the chapter" : "Read the chapter" }
      if (ids.length === 1 && typeof i.around === "number") return { title: `Read ¶${ids[0]} and ${i.around} around` }
      return { title: ids.length ? `Read ${paras(ids)}` : "Read" }
    }
    case "book": return { title: "Looked at the book's chapters" }
    case "glossary": return { title: "Read the glossary" }
    case "search": return { title: `Searched “${String(i.query ?? "")}”` }
    case "WebSearch": return { title: `Searched the web for “${String(i.query ?? "")}”` }
    case "set_translation": return write(`Writing the translation of ${p}`, `Wrote the translation of ${p}`, `Did not write the translation of ${p}`)
    case "set_glossary_term": return write(`Glossary: ${i.term} → ${i.translation}`, `Glossary: ${i.term} → ${i.translation}`, `Did not change the glossary for ${i.term}`)
    case "add_comment": return write(`Commenting on ${p}`, `Commented on ${p}`, `Did not comment on ${p}`)
    case "add_translator_note": return write(`Adding a translator's note to ${p}`, `Added a translator's note to ${p}`, `Did not add a translator's note to ${p}`)
    case "StructuredOutput": return null
    default: return { title: t.name }
  }
}

/** Why a call did not go through, in a few words. */
function why(result: unknown): string {
  const text = typeof result === "string" ? result : ""
  if (/declined/i.test(text)) return "you declined"
  if (/stopped/i.test(text)) return "stopped"
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/** The block being written now, while it streams: a tool's arguments are not readable until it is done. */
const DOING: Record<string, string> = {
  read: "Reading", book: "Looking at the book", glossary: "Reading the glossary", search: "Searching", WebSearch: "Searching the web",
  set_translation: "Writing a translation", set_glossary_term: "Changing the glossary", add_comment: "Writing a comment", add_translator_note: "Writing a translator's note",
}
export const doingLine = (name: string | undefined) => (name && DOING[name]) ?? "Working"

/** The live line's words while a turn goes, from Enter to the answer (docs/agent.md §26): sent and not yet echoed,
 *  what streams in now, or between blocks. A write waiting for the translator outranks the rest. null while Claude's
 *  words stream: they show it. */
export function liveLine({ sent, live, began, waiting, retry = null, compacting = false }: {
  sent: boolean; live: { kind: string; name?: string } | null; began: boolean; waiting: boolean
  retry?: { attempt: number; max: number; delayMs: number; error: string | null } | null
  compacting?: boolean
}): string | null {
  if (waiting) return "Waiting for your answer"
  if (compacting) return "Compacting"
  // a request being tried again (docs/agent.md §29): not stuck, waiting
  if (retry) return `Retrying ${retry.attempt}/${retry.max}${retry.error ? ` · ${retry.error}` : ""} · ${Math.max(1, Math.round(retry.delayMs / 1000))}s`
  if (sent) return "Starting"
  if (live?.kind === "text") return null
  if (live?.kind === "tool") return doingLine(live.name)
  return live?.kind === "thinking" || !began ? "Thinking" : "Working"
}

/** The time since the turn began, as the live line shows it: tenths of a second, then minutes. */
export function elapsedText(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100))
  return tenths < 600 ? `${(tenths / 10).toFixed(1)}s` : `${Math.floor(tenths / 600)}m ${((tenths % 600) / 10).toFixed(1)}s`
}

const time = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })

/** Tokens in a few figures: 5028 → "5.0k", 571516 → "572k". */
export const tokens = (n: number) => (n >= 100_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
/** Where the conversation was compacted (docs/agent.md §32): what it was, what it became. */
export const compactLine = (c: { pre: number | null; post: number | null }) =>
  c.pre !== null && c.post !== null ? `Compacted ${tokens(c.pre)} → ${tokens(c.post)}` : "Compacted"

/** Why the API did not answer, so the translator knows what to do next (docs/agent.md §29). */
function stoppedLine(error: string, limits: { resetsAt: number | null } | null): string {
  switch (error) {
    case "authentication_failed": return "Not logged in — run `claude /login` in a terminal"
    case "rate_limit": return limits?.resetsAt ? `Usage limit reached — resets at ${time(limits.resetsAt)}` : "Usage limit reached"
    case "overloaded": return "Claude is overloaded — try again in a moment"
    case "billing_error": return "A billing problem on the account"
    default: return `Claude stopped: ${error}`
  }
}

/** A turn's end: how long, or why it ended early. Not what it cost: on the translator's subscription that is Claude
 *  Code's estimate, not a bill (docs/agent.md §17). The record keeps it. */
export function turnLine(t: Turn, limits: { resetsAt: number | null } | null = null): { text: string; stopped: boolean } {
  if (t.reason === "aborted_streaming" || t.reason === "aborted_tools") return { text: "Stopped", stopped: true }
  if (t.error) return { text: stoppedLine(t.error, limits), stopped: true }
  if (t.isError) return { text: `Claude stopped: ${t.reason}`, stopped: true }
  return { text: t.ms != null ? `${Math.max(1, Math.round(t.ms / 1000))}s` : "", stopped: false }
}

type Checks = { checked: number[]; rounds: ({ segmentId: number; kind: "term"; term: string; forms: string[] } | { segmentId: number; kind: "note"; quote: string })[][]; error?: string }

/** A turn's checks in a line (docs/agent.md §19): passed (after being sent back how often), what is left wrong, or
 *  not checked and why — never shown as passed when it was not. */
export function checksLine(c: Checks): { ok: boolean | null; text: string; details: string[] } {
  if (c.error) return { ok: null, text: "Not checked", details: [c.error] }
  const left = c.rounds.at(-1) ?? []
  const sent = c.rounds.length - 1
  const after = sent ? ` after ${sent} ${sent === 1 ? "try" : "tries"}` : ""
  if (!left.length) return { ok: true, text: `Checked ${paras(c.checked)}${sent ? ` · fixed${after}` : ""}`, details: [] }
  return {
    ok: false,
    text: `${left.length} problem${left.length === 1 ? "" : "s"} left${after}`,
    details: left.map((f) => (f.kind === "term" ? `¶${f.segmentId}: “${f.term}” → ${f.forms.join(" / ")} is not in the translation` : `¶${f.segmentId}: the note at “${f.quote}” lost its place`)),
  }
}

/** How long ago, briefly: now, 5m, 2h, 3d. `at` is SQLite's datetime('now'), UTC without a zone. */
export function ago(at: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(`${at.replace(" ", "T")}Z`)) / 1000)
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`
}
