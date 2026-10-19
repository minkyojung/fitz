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
  read: "Reading", book: "Looking at the book", glossary: "Reading the glossary", search: "Searching",
  set_translation: "Writing a translation", set_glossary_term: "Changing the glossary", add_comment: "Writing a comment", add_translator_note: "Writing a translator's note",
}
export const doingLine = (name: string | undefined) => (name && DOING[name]) ?? "Working"

/** A turn's end: how long and how much, or why it ended early. */
export function turnLine(t: Turn): { text: string; stopped: boolean } {
  if (t.reason === "aborted_streaming" || t.reason === "aborted_tools") return { text: "Stopped", stopped: true }
  if (t.isError) return { text: `Claude stopped: ${t.reason}`, stopped: true }
  const parts = [t.ms != null ? `${Math.max(1, Math.round(t.ms / 1000))}s` : null, t.cost != null ? `$${t.cost < 0.1 ? t.cost.toFixed(3) : t.cost.toFixed(2)}` : null]
  return { text: parts.filter(Boolean).join(" · "), stopped: false }
}

/** How long ago, briefly: now, 5m, 2h, 3d. `at` is SQLite's datetime('now'), UTC without a zone. */
export function ago(at: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(`${at.replace(" ", "T")}Z`)) / 1000)
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`
}
