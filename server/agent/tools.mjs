// The agent's tools over book.db, one per question it asks (docs/agent.md §3).
// Read tools return plain text only: no ProseMirror JSON, no OCR original, no page boxes or file paths,
// so nothing but the book's text can reach the model. Write tools go through execute(), like every edit the
// translator makes: each is logged and undone with ⌘Z. Claude Code asks the app before each write (session.mjs).
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

import { makeAnchor } from "../anchor.mjs"
import { anchorOf, execute, getBook, httpError, listChapters, listGlossary, search } from "../commands.mjs"
import { termPattern } from "./glossaryRule.mjs"

/** Characters of text one `read` returns before it stops and hands back `next`. Claude Code moves an MCP
 *  result over 25,000 tokens or 50,000 characters into a file, which this agent has no tool to open. */
export const READ_BUDGET = 20000

/** Glossary terms a source paragraph mentions, by the glossary rule the editor uses too (glossaryRule.mjs). */
const termsIn = (text, entries) =>
  entries.filter((e) => e.term.trim() && termPattern(e.term).test(text))
    .map(({ term, translation, aliases, kind }) => ({ term, translation, aliases, kind }))

export function book(db) {
  const chapters = listChapters(db).map(({ id, idx, title, startPage, segmentCount, confirmedCount }) => ({ id, idx, title, startPage, segmentCount, confirmedCount }))
  return { ...getBook(db), chapters }
}

const BOOK_ORDER = "SELECT s.* FROM segment s JOIN chapter c ON c.id = s.chapter_id"

/** Paragraphs with what is attached to them. Exactly one of `ids` / `chapterId`; `around` widens a single id
 *  to its neighbours in the chapter; `from` continues a chapter at that idx. Stops at READ_BUDGET. */
export function read(db, { ids, chapterId, around, from } = {}) {
  if ((ids === undefined) === (chapterId === undefined)) throw httpError(400, "give either ids or chapterId")
  if (around !== undefined && ids?.length !== 1) throw httpError(400, "around needs exactly one id")
  if (from !== undefined && chapterId === undefined) throw httpError(400, "from goes with chapterId")
  let rows
  if (chapterId !== undefined) {
    if (!db.prepare("SELECT 1 FROM chapter WHERE id = ?").get(chapterId)) throw httpError(404, `chapter ${chapterId} not found`)
    rows = db.prepare("SELECT * FROM segment WHERE chapter_id = ? AND idx >= ? ORDER BY idx").all(chapterId, from ?? 0)
  } else {
    const found = db.prepare(`${BOOK_ORDER} WHERE s.id IN (${ids.map(() => "?").join(",")}) ORDER BY c.idx, s.idx`).all(...ids)
    const missing = ids.filter((id) => !found.some((r) => r.id === id))
    if (missing.length) throw httpError(404, `segment ${missing.join(", ")} not found`)
    rows = around === undefined ? found
      : db.prepare("SELECT * FROM segment WHERE chapter_id = ? AND idx BETWEEN ? AND ? ORDER BY idx").all(found[0].chapter_id, found[0].idx - around, found[0].idx + around)
  }

  const terms = db.prepare("SELECT term, translation, aliases, kind FROM glossary WHERE book_id = ?").all(getBook(db).id)
    .map((r) => ({ term: r.term, translation: r.translation, aliases: r.aliases ?? "", kind: r.kind }))
  const notesOf = db.prepare("SELECT * FROM note WHERE segment_id = ? ORDER BY tgt_start, id")
  const commentsOf = db.prepare("SELECT * FROM comment WHERE segment_id = ? ORDER BY id")
  const segments = []
  let used = 0
  for (const r of rows) {
    const notes = notesOf.all(r.id).map((n) => n.kind === "author"
      ? { id: n.id, kind: "author", text: n.body_source ?? "", translation: n.body_target ?? "", quote: anchorOf(n, "src")?.exact ?? n.orig_quote ?? null }
      : { id: n.id, kind: "translator", text: n.body_target ?? "", quote: anchorOf(n, "tgt")?.exact ?? null })
    const comments = commentsOf.all(r.id).map((c) => ({ id: c.id, parentId: c.parent_id ?? null, side: c.side, author: c.author, body: c.body, resolved: c.resolved === 1, quote: anchorOf(c, "src")?.exact ?? null }))
    const seg = {
      id: r.id, chapterId: r.chapter_id, idx: r.idx, kind: r.kind, pageStart: r.page_start, pageEnd: r.page_end,
      status: r.status, version: r.version, sourceText: r.source_text, targetText: r.target_text ?? "",
      notes, comments, terms: termsIn(r.source_text, terms),
    }
    const size = seg.sourceText.length + seg.targetText.length
      + notes.reduce((n, x) => n + x.text.length + (x.translation?.length ?? 0), 0) + comments.reduce((n, x) => n + x.body.length, 0)
    if (segments.length && used + size > READ_BUDGET) {
      const rest = rows.slice(segments.length)
      return { segments, next: chapterId !== undefined ? { chapterId, from: rest[0].idx } : { ids: rest.map((x) => x.id) } }
    }
    segments.push(seg)
    used += size
  }
  return { segments }
}

export const glossary = (db) =>
  ({ terms: listGlossary(db, { bookId: getBook(db).id }).map(({ term, translation, aliases, kind, occurrences }) => ({ term, translation, aliases, kind, occurrences })) })

export const searchBook = (db, { query }) => ({ hits: search(db, { query }) })

// --- writes: the agent's door. Each is recorded as the agent's, with the id of the tool call that made it.

/** The agent as the author of a write; toolUseId is what Claude Code hands a tool call (measured, 2.1.302). */
export const agentBy = (extra) => ({ actor: "agent", toolUseId: extra?._meta?.["claudecode/toolUseId"] ?? null })
const AGENT = agentBy(undefined)

const KINDS = ["person", "place", "org", "work", "other"]

function segmentAt(db, id) {
  const row = db.prepare("SELECT * FROM segment WHERE id = ?").get(id)
  if (!row) throw httpError(404, `segment ${id} not found`)
  return row
}
/** Translation text as blocks: one per line, blank lines dropped. */
const blocksOf = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean)
/** A quote must be found once, so the anchor points at one place. */
function quoteAnchor(text, quote, where) {
  if (quote === undefined) return null
  const at = text.indexOf(quote)
  if (!quote || at === -1) throw httpError(400, `"${quote}" is not in the paragraph's ${where}`)
  if (text.indexOf(quote, at + 1) !== -1) throw httpError(400, `"${quote}" appears more than once in the paragraph's ${where}; quote more of it`)
  return makeAnchor(text, at, at + quote.length)
}

const CHANGED = (id) => `¶${id} changed since you read it; read it again before writing`

/** Write a paragraph's translation, always as draft: confirming is the translator's. expectVersion is the version
 *  read gave; updateSegment refuses the write if the paragraph changed since — the same check the editor's saves get. */
export function setTranslation(db, { segmentId, text, expectVersion }, by = AGENT) {
  const blocks = blocksOf(text)
  if (!blocks.length) throw httpError(400, "the translation is empty")
  const targetDoc = { type: "doc", content: blocks.map((b) => ({ type: "paragraph", content: [{ type: "text", text: b }] })) }
  try {
    const seg = execute(db, "updateSegment", { id: segmentId, targetDoc, status: "draft", expectVersion }, by)
    return { segmentId, status: seg.status, version: seg.version, targetText: seg.targetText }
  } catch (e) {
    throw e.status === 409 ? httpError(409, CHANGED(segmentId)) : e
  }
}

/** Agree a term's Korean form. Aliases and kind not given keep what the entry had. */
export function setGlossaryTerm(db, { term, translation, aliases, kind }, by = AGENT) {
  const bookId = getBook(db).id
  const cur = db.prepare("SELECT * FROM glossary WHERE book_id = ? AND term = ?").get(bookId, term)
  return execute(db, "setGlossaryTerm", { bookId, term, translation, aliases: aliases ?? cur?.aliases ?? "", kind: kind ?? cur?.kind ?? "other" }, by)
}

export function addComment(db, { segmentId, side, body, quote }, by = AGENT) {
  const cur = segmentAt(db, segmentId)
  const anchor = quoteAnchor(side === "source" ? cur.source_text : cur.target_text ?? "", quote, side === "source" ? "source" : "translation")
  const c = execute(db, "addComment", { segmentId, side, anchor, body, author: by.actor }, by)
  return { id: c.id, segmentId, side, quote: quote ?? null }
}

/** A translator's note sits in the translation: its quote is found there. */
export function addTranslatorNote(db, { segmentId, body, quote }, by = AGENT) {
  const cur = segmentAt(db, segmentId)
  if (quote !== undefined && !cur.target_text) throw httpError(400, `¶${segmentId} has no translation yet to place the note in`)
  const n = execute(db, "addNote", { segmentId, anchor: quoteAnchor(cur.target_text ?? "", quote, "translation"), body }, by)
  return { id: n.id, segmentId, quote: quote ?? null }
}

/** What a write would do, for the translator to approve: a line saying what, and the text before and after.
 *  It checks what the write will check, so the translator is never asked about a write that would then fail. */
export function describeWrite(db, tool, input) {
  switch (tool) {
    case "set_translation": {
      const cur = segmentAt(db, input.segmentId)
      if (cur.version !== input.expectVersion) throw httpError(409, CHANGED(cur.id))
      if (!blocksOf(input.text).length) throw httpError(400, "the translation is empty")
      const demoted = cur.status === "reviewed" || cur.status === "final"
      return { summary: `Write the translation of ¶${cur.id}${demoted ? ` (it is ${cur.status}; it becomes draft)` : ""}`, segmentId: cur.id, before: cur.target_text || null, after: blocksOf(input.text).join("\n") }
    }
    case "set_glossary_term": {
      const cur = db.prepare("SELECT * FROM glossary WHERE book_id = ? AND term = ?").get(getBook(db).id, input.term)
      return { summary: `Glossary: ${input.term} → ${input.translation}`, segmentId: null, before: cur ? `${cur.term} → ${cur.translation}` : null, after: `${input.term} → ${input.translation}${input.aliases ? ` (also ${input.aliases})` : ""}` }
    }
    case "add_comment": {
      const cur = segmentAt(db, input.segmentId)
      quoteAnchor(input.side === "source" ? cur.source_text : cur.target_text ?? "", input.quote, input.side === "source" ? "source" : "translation")
      return { summary: `Comment by Claude on ¶${cur.id}${input.quote ? ` at "${input.quote}"` : ""}`, segmentId: input.segmentId, before: null, after: input.body }
    }
    case "add_translator_note": {
      const cur = segmentAt(db, input.segmentId)
      if (input.quote !== undefined && !cur.target_text) throw httpError(400, `¶${cur.id} has no translation yet to place the note in`)
      quoteAnchor(cur.target_text ?? "", input.quote, "translation")
      return { summary: `Translator's note on ¶${cur.id}${input.quote ? ` after "${input.quote}"` : ""} — it will be printed`, segmentId: input.segmentId, before: null, after: input.body }
    }
    default:
      throw httpError(400, `${tool} is not a write tool`)
  }
}

// --- MCP: the same functions as tools. A thrown error reaches the model as an error result and the turn goes on.

const result = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data })
const READ_ONLY = { annotations: { readOnlyHint: true } }

export const readTools = (db) => [
  tool("book", "The book being translated: title, author, and its chapters in order with how many paragraphs each has and how many are confirmed.",
    {}, async () => result(book(db)), READ_ONLY),
  tool("read",
    "Read paragraphs: the English source, the Korean translation so far (empty if none), status, and what is attached — author's notes, translator's notes, comments, and the glossary terms the paragraph mentions with their agreed Korean form. " +
    "Give `ids`, or `chapterId` for a whole chapter. With one id, `around: n` adds n paragraphs before and after it in the same chapter. " +
    "Long reads stop part way and return `next`: call read again with exactly those arguments to continue.",
    {
      ids: z.array(z.number().int()).min(1).max(200).optional().describe("Paragraph ids, returned in book order"),
      chapterId: z.number().int().optional().describe("Read a chapter's paragraphs in order"),
      around: z.number().int().min(1).max(10).optional().describe("With exactly one id: paragraphs on each side to include"),
      from: z.number().int().min(0).optional().describe("With chapterId: start at this paragraph idx (as given in `next`)"),
    },
    async (args) => result(read(db, args)), READ_ONLY),
  tool("glossary", "The book's glossary: each source term, its agreed Korean form (empty = not decided yet), accepted variants, kind, and how many paragraphs mention it.",
    {}, async () => result(glossary(db)), READ_ONLY),
  tool("search", "Find paragraphs whose English source contains the exact text (case-sensitive). Returns where, how many times, and a snippet.",
    { query: z.string().min(1).describe("Exact text to find") },
    async (args) => result(searchBook(db, args)), READ_ONLY),
]

/** The in-process MCP server handed to query() as mcpServers.fitz. alwaysLoad keeps the schemas in the prompt,
 *  so the first call is not preceded by a ToolSearch round trip. */
/** `wrote(segmentId)` hears each paragraph a set_translation wrote, as it is written: the checks of the turn
 *  (docs/agent.md §19) take these, with no wait on the stream. */
export const writeTools = (db, { wrote } = {}) => [
  tool("set_translation",
    "Write the Korean translation of one paragraph, replacing what is there. It is saved as a draft for the translator to confirm. " +
    "Pass the paragraph's `version` from your last read as `expectVersion`; if the paragraph changed since (the translator may be editing too), the write is refused and you should read it again. " +
    "Separate blocks with a newline. The translator is asked before it is written.",
    {
      segmentId: z.number().int(),
      text: z.string().min(1).describe("The whole translation of the paragraph"),
      expectVersion: z.number().int().describe("version of the paragraph as read returned it"),
    },
    async (args, extra) => {
      const out = setTranslation(db, args, agentBy(extra))
      wrote?.(out.segmentId)
      return result(out)
    }),
  tool("set_glossary_term",
    "Agree the Korean form of a source term (a name, place, title…) for the whole book, or change it. The translator is asked first.",
    {
      term: z.string().min(1).describe("The term as it appears in the English source"),
      translation: z.string().min(1).describe("Its agreed Korean form"),
      aliases: z.string().optional().describe("Other accepted Korean forms, comma-separated"),
      kind: z.enum(KINDS).optional(),
    },
    async (args, extra) => result(setGlossaryTerm(db, args, agentBy(extra)))),
  tool("add_comment",
    "Leave a working comment on a paragraph for the translator (never printed). `quote` pins it to exact words in that side's text. The translator is asked first.",
    {
      segmentId: z.number().int(),
      side: z.enum(["source", "target"]).describe("source: the English; target: the translation"),
      body: z.string().min(1),
      quote: z.string().optional().describe("Exact words from that side, found once"),
    },
    async (args, extra) => result(addComment(db, args, agentBy(extra)))),
  tool("add_translator_note",
    "Add a translator's note (역주) to a paragraph; it is printed in the book. `quote` places its mark right after exact words of the translation. The translator is asked first.",
    {
      segmentId: z.number().int(),
      body: z.string().min(1).describe("The note's text, in Korean"),
      quote: z.string().optional().describe("Exact words of the translation, found once"),
    },
    async (args, extra) => result(addTranslatorNote(db, args, agentBy(extra)))),
]

export const READ_TOOL_NAMES = ["book", "read", "glossary", "search"]
export const WRITE_TOOL_NAMES = ["set_translation", "set_glossary_term", "add_comment", "add_translator_note"]

/** `write: false` for the tasks, which only find: Claude is not even offered the write tools. */
export const fitzTools = (db, { write = true, wrote } = {}) => (write ? [...readTools(db), ...writeTools(db, { wrote })] : readTools(db))
export const fitzServer = (db, options) => createSdkMcpServer({ name: "fitz", version: "0.1.0", alwaysLoad: true, tools: fitzTools(db, options) })
